// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Admin alerts (2026-11-24): late or failed jobs, unclaimed paid orders,
 * completions and support tickets waiting, against an in-memory PostgreSQL
 * (all migrations). Each alert is sent once (dedupe keys).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn(), broadcastEvent: vi.fn() }));
vi.mock("@/lib/catalog/game-services", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog/game-services")>()),
  getGameServiceOffer: (g: string, s: string) => h.offers.find((o) => o.gameSlug === g && o.serviceSlug === s),
}));
vi.mock("@/lib/config/checkout-options", () => ({
  getCheckoutConfig: (g: string, s: string) => h.checkouts.find((c) => c.gameSlug === g && c.serviceSlug === s),
}));
vi.mock("@/lib/stripe/server", async (orig) => {
  const actual = await orig<typeof import("@/lib/stripe/server")>();
  return { ...actual, getStripe: () => h.stripe.client };
});

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { claimAndStart, configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser, setConfig } from "../support/payment-fixtures";
import {
  jobProblems,
  runCompletionWaitingAlerts,
  runJobHealthAlerts,
  runTicketWaitingAlerts,
  runUnclaimedOrderAlerts,
} from "@/lib/automation/admin-alerts";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
const MIN = 60_000;
const HOUR = 3_600_000;
const later = (ms: number) => new Date(Date.now() + ms);
/** One user's alerts of one kind (by title). */
const alertsFor = (userId: string, title: string) => prisma.notification.findMany({ where: { userId, title, dedupeKey: { not: null } } });

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://app.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  await configurePrice(admin.id, 2500, 2500);
  await setConfig("claim_now_discount_bps", 0);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

describe("job health", () => {
  it("a late job and a failed job alert admins once per incident; healthy jobs do not", async () => {
    const now = new Date();
    await prisma.jobLease.createMany({
      data: [
        { name: "close-bidding", lastStartedAt: new Date(now.getTime() - 30 * MIN), lastFinishedAt: new Date(now.getTime() - 30 * MIN), lastStatus: "ok" },
        { name: "outbox-dispatch", lastStartedAt: new Date(now.getTime() - 2 * MIN), lastFinishedAt: new Date(now.getTime() - 2 * MIN), lastStatus: "error", lastError: "boom" },
        { name: "close-stale-holds", lastStartedAt: new Date(now.getTime() - 5 * MIN), lastFinishedAt: new Date(now.getTime() - 5 * MIN), lastStatus: "ok" },
      ],
    });
    const problems = await jobProblems(now);
    expect(problems.map((p) => `${p.job}:${p.problem}`).sort()).toEqual(["close-bidding:late", "outbox-dispatch:failed"]);

    await runJobHealthAlerts(now);
    await runJobHealthAlerts(now); // same incidents: no second alert
    const sent = await alertsFor(admin.id, "Scheduled Job Problem");
    expect(sent).toHaveLength(2);
    expect(sent.map((n) => n.message).join(" ")).toMatch(/close-bidding" has not run for 30 minutes/);
    expect(sent.map((n) => n.message).join(" ")).toMatch(/outbox-dispatch" failed: boom/);
    await prisma.jobLease.deleteMany({});
  });
});

describe("unclaimed orders", () => {
  it("after 30 minutes: admins (with the order link) and eligible boosters (no link), once per round", async () => {
    await setConfig("unclaimed_alert_min", 30);
    const customer = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);

    expect((await runUnclaimedOrderAlerts(later(10 * MIN))).unclaimedAlerts).toBe(0); // too early
    expect((await runUnclaimedOrderAlerts(later(31 * MIN))).unclaimedAlerts).toBeGreaterThanOrEqual(1);
    await runUnclaimedOrderAlerts(later(40 * MIN)); // no repeat

    const toAdmin = (await alertsFor(admin.id, "Order Waiting For A Booster")).filter((n) => n.orderId === orderId);
    expect(toAdmin).toHaveLength(1);
    const toBooster = await alertsFor(booster.id, "Order Waiting For A Booster");
    expect(toBooster.some((n) => n.orderId === null && n.message.includes(orderId.slice(-8).toUpperCase()))).toBe(true);
  });

  it("a taken order is not unclaimed", async () => {
    const customer = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await claimAndStart(orderId, booster.id);
    await runUnclaimedOrderAlerts(later(2 * HOUR));
    expect((await alertsFor(admin.id, "Order Waiting For A Booster")).some((n) => n.orderId === orderId)).toBe(false);
  });
});

describe("completions waiting", () => {
  it("after 4 hours, then once a day", async () => {
    await setConfig("completion_wait_alert_hours", 4);
    const customer = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await claimAndStart(orderId, booster.id);
    const assignment = await prisma.orderBoosterAssignment.findFirstOrThrow({ where: { orderId, boosterId: booster.id } });
    await prisma.orderCompletionRequest.create({
      data: { orderId, assignmentId: assignment.id, boosterId: booster.id, status: "PENDING", autoConfirmAt: later(72 * HOUR) },
    });

    await runCompletionWaitingAlerts(later(1 * HOUR));
    await runCompletionWaitingAlerts(later(5 * HOUR));
    await runCompletionWaitingAlerts(later(6 * HOUR)); // same day: no repeat
    await runCompletionWaitingAlerts(later(29 * HOUR)); // next day: one more
    const sent = (await alertsFor(admin.id, "Completion Still Waiting")).filter((n) => n.orderId === orderId);
    expect(sent).toHaveLength(2);
  });
});

describe("support tickets waiting", () => {
  it("a customer message unanswered for 12 hours alerts; an admin reply stops it", async () => {
    await setConfig("ticket_reply_alert_hours", 12);
    const customer = await seedUser("CUSTOMER");
    const t = await prisma.supportTicket.create({
      data: { customerId: customer.id, subject: "Booster offline", description: "Nobody plays", category: "ORDER_ISSUE" },
    });
    await runTicketWaitingAlerts(later(2 * HOUR));
    await runTicketWaitingAlerts(later(13 * HOUR));
    await runTicketWaitingAlerts(later(14 * HOUR));
    let sent = (await alertsFor(admin.id, "Ticket Waiting For A Reply")).filter((n) => n.message.includes("Booster offline"));
    expect(sent).toHaveLength(1);

    await prisma.supportMessage.create({ data: { ticketId: t.id, senderId: admin.id, content: "Looking", isAdminReply: true } });
    await runTicketWaitingAlerts(later(30 * HOUR));
    sent = (await alertsFor(admin.id, "Ticket Waiting For A Reply")).filter((n) => n.message.includes("Booster offline"));
    expect(sent).toHaveLength(1);
  });
});
