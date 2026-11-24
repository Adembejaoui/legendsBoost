// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Stalled orders (2026-11-24) against an in-memory PostgreSQL: 45 min
 * no-contact alert, 2 h email, final warning, then the order is taken back
 * (not started -> pool, in progress -> draft) with an automatic fine,
 * doubled on repeats; the 3rd in 30 days blocks new claims.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn(), broadcastEvent: vi.fn() }));
vi.mock("@/lib/realtime/live", () => ({ signalPool: vi.fn(), signalUsers: vi.fn() }));
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
import { runStalledOrders, stallStage, FINAL_WARNING_MIN_LEAD_MS } from "@/lib/boosters/stall";
import { liftClaimBlock } from "@/lib/boosters/discipline";
import { claimOrder } from "@/lib/assignments/service";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
const MIN = 60_000;
const HOUR = 3_600_000;
const later = (ms: number) => new Date(Date.now() + ms);
const titled = (userId: string, title: string, orderId?: string) =>
  prisma.notification.findMany({ where: { userId, title, ...(orderId ? { orderId } : {}) } });
const assignmentOf = (orderId: string, boosterId: string) =>
  prisma.orderBoosterAssignment.findFirstOrThrow({ where: { orderId, boosterId }, orderBy: { assignedAt: "desc" } });

/** Final warning at 23 h, then the release run at 24 h. */
async function runToRelease() {
  await runStalledOrders(later(23 * HOUR + 1 * MIN));
  return runStalledOrders(later(24 * HOUR + 2 * MIN));
}

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://app.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  await configurePrice(admin.id, 2500, 2500);
  await setConfig("claim_now_discount_bps", 0);
  await setConfig("max_concurrent_orders", 5);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

describe("stallStage (pure)", () => {
  const s = { emailHours: 2, releaseHours: 24 };
  const last = new Date("2026-11-24T00:00:00Z");
  const at = (h: number) => new Date(last.getTime() + h * HOUR);
  const none = { stallEmailedAt: null, stallFinalWarnedAt: null };

  it("email at 2 h, final at 23 h, release at 24 h only after the final warning", () => {
    expect(stallStage(none, last, at(1), s)).toBeNull();
    expect(stallStage(none, last, at(2), s)).toBe("email");
    expect(stallStage({ stallEmailedAt: at(2), stallFinalWarnedAt: null }, last, at(5), s)).toBeNull();
    expect(stallStage({ stallEmailedAt: at(2), stallFinalWarnedAt: null }, last, at(23), s)).toBe("final");
    // Job was down: 30 h idle but no final warning yet -> final first, never a release without warning.
    expect(stallStage({ stallEmailedAt: at(2), stallFinalWarnedAt: null }, last, at(30), s)).toBe("final");
    const warned = { stallEmailedAt: at(23), stallFinalWarnedAt: at(23) };
    expect(stallStage(warned, last, at(24), s)).toBe("release");
    // Final warning only 10 minutes old: wait.
    const fresh = { stallEmailedAt: at(29.9), stallFinalWarnedAt: new Date(at(30).getTime() - 10 * MIN) };
    expect(stallStage(fresh, last, at(30), s)).toBeNull();
    expect(stallStage(fresh, last, new Date(fresh.stallFinalWarnedAt.getTime() + FINAL_WARNING_MIN_LEAD_MS), s)).toBe("release");
  });

  it("warnings from an earlier quiet spell do not count after new activity", () => {
    const old = { stallEmailedAt: new Date(last.getTime() - HOUR), stallFinalWarnedAt: new Date(last.getTime() - HOUR) };
    expect(stallStage(old, last, at(2), s)).toBe("email");
    expect(stallStage(old, last, at(24), s)).toBe("final");
  });
});

describe("no message after the claim", () => {
  it("alerts the booster once at 45 minutes, not when they already wrote", async () => {
    const customer = await seedUser("CUSTOMER");
    const quiet = await seedUser("BOOSTER");
    const chatty = await seedUser("BOOSTER");
    const a = await createPaidOrder(customer.id);
    const b = await createPaidOrder(customer.id);
    await claimOrder(a.orderId, quiet.id);
    await claimOrder(b.orderId, chatty.id);
    const conv = await prisma.orderConversation.upsert({ where: { orderId: b.orderId }, create: { orderId: b.orderId }, update: {} });
    await prisma.orderMessage.create({ data: { conversationId: conv.id, senderId: chatty.id, content: "Hi!" } });

    await runStalledOrders(later(30 * MIN));
    expect(await titled(quiet.id, "Message Your Customer Now")).toHaveLength(0);
    await runStalledOrders(later(46 * MIN));
    await runStalledOrders(later(50 * MIN));
    expect(await titled(quiet.id, "Message Your Customer Now", a.orderId)).toHaveLength(1);
    expect(await titled(chatty.id, "Message Your Customer Now")).toHaveLength(0);
  });
});

describe("taken back", () => {
  it("not started: email at 2 h, final warning, then back to the pool with a 10% fine", async () => {
    await setConfig("stall_fine_not_started_bps", 1000);
    const customer = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await claimOrder(orderId, booster.id);
    const before = await assignmentOf(orderId, booster.id);
    const payout = before.payoutAmount!;
    expect(payout).toBeGreaterThan(0);

    const r1 = await runStalledOrders(later(2 * HOUR + MIN));
    expect(r1.stallEmails).toBeGreaterThanOrEqual(1);
    await runStalledOrders(later(2 * HOUR + 10 * MIN)); // no repeat
    expect(await titled(booster.id, "Order Needs Activity", orderId)).toHaveLength(1);
    expect(await prisma.outboxEvent.count({ where: { type: "EMAIL_BOOSTER_STALL", dedupeKey: { startsWith: `stall-email:${before.id}` } } })).toBe(1);

    await runToRelease();
    expect(await titled(booster.id, "Order Taken Back In 1 Hour", orderId)).toHaveLength(1);

    const after = await prisma.orderBoosterAssignment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe("RELEASED");
    expect(after.endReason).toMatch(/^AUTO_RELEASED/);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING");

    const fine = await prisma.boosterFine.findFirstOrThrow({ where: { orderId, boosterId: booster.id } });
    expect(fine.code).toBe("AUTO_RELEASE_NOT_STARTED");
    expect(fine.amount).toBe(Math.round(payout * 0.1));
    expect(fine.status).toBe("ISSUED");
    const ledger = await prisma.financialTransaction.findMany({ where: { idempotencyKey: { startsWith: `fine:${fine.id}:` } } });
    expect(ledger.map((l) => `${l.account}:${l.amount}`).sort()).toEqual([`BOOSTER_PAYABLE:${-fine.amount}`, `PLATFORM_REVENUE:${fine.amount}`].sort());
    expect(await prisma.boosterStrike.count({ where: { boosterId: booster.id, code: "AUTO_RELEASE", fineId: fine.id } })).toBe(1);

    expect((await titled(booster.id, "Order Taken Back", orderId))[0]?.message).toMatch(/taken back after 24 hours/);
    expect((await titled(customer.id, "Order Taken Back", orderId))[0]?.message).toMatch(/back on the marketplace/);
    expect(await titled(admin.id, "Order Taken Back", orderId)).toHaveLength(1);

    // A second run does nothing more.
    await runStalledOrders(later(26 * HOUR));
    expect(await prisma.boosterFine.count({ where: { orderId } })).toBe(1);
  });

  it("in progress: to draft for admin review with a 20% fine", async () => {
    await setConfig("stall_fine_in_progress_bps", 2000);
    const customer = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await claimAndStart(orderId, booster.id);
    const a = await assignmentOf(orderId, booster.id);

    await runToRelease();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DRAFT");
    const fine = await prisma.boosterFine.findFirstOrThrow({ where: { orderId } });
    expect(fine.code).toBe("AUTO_RELEASE_IN_PROGRESS");
    expect(fine.amount).toBe(Math.round(a.payoutAmount! * 0.2));
    expect((await titled(customer.id, "Order Taken Back", orderId))[0]?.message).toMatch(/keep your progress/);
  });

  it("activity resets the clock and a paused order is never taken back", async () => {
    const customer = await seedUser("CUSTOMER");
    const active = await seedUser("BOOSTER");
    const paused = await seedUser("BOOSTER");
    const a = await createPaidOrder(customer.id);
    const b = await createPaidOrder(customer.id);
    await claimAndStart(a.orderId, active.id);
    await claimAndStart(b.orderId, paused.id);
    const assignmentA = await assignmentOf(a.orderId, active.id);
    // The booster posted a rank update 22 hours in.
    await prisma.orderProgressUpdate.create({
      data: { orderId: a.orderId, assignmentId: assignmentA.id, boosterId: active.id, rankSystemId: "lol", tierId: "gold", createdAt: later(22 * HOUR) },
    });
    await prisma.order.update({ where: { id: b.orderId }, data: { status: "PAUSED" } });

    await runToRelease();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe("IN_PROGRESS");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe("PAUSED");
    expect(await titled(active.id, "Order Taken Back In 1 Hour", a.orderId)).toHaveLength(0);
    expect(await prisma.boosterFine.count({ where: { orderId: { in: [a.orderId, b.orderId] } } })).toBe(0);
  });
});

describe("repeat offenders", () => {
  it("2nd release in 30 days doubles the fine; the 3rd doubles it and blocks new claims until an admin lifts it", async () => {
    await setConfig("stall_fine_not_started_bps", 1000);
    const customer = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const fines: number[] = [];
    const payouts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { orderId } = await createPaidOrder(customer.id);
      await claimOrder(orderId, booster.id);
      payouts.push((await assignmentOf(orderId, booster.id)).payoutAmount!);
      await runToRelease();
      fines.push((await prisma.boosterFine.findFirstOrThrow({ where: { orderId, boosterId: booster.id } })).amount);
    }
    expect(fines[0]).toBe(Math.round(payouts[0] * 0.1));
    expect(fines[1]).toBe(Math.round(payouts[1] * 0.1) * 2);
    expect(fines[2]).toBe(Math.round(payouts[2] * 0.1) * 2);

    const profile = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: booster.id } });
    expect(profile.claimBlockedAt).not.toBeNull();
    const last = (await titled(booster.id, "Order Taken Back")).at(-1);
    expect(last?.message).toMatch(/cannot take new orders/);

    const { orderId: next } = await createPaidOrder(customer.id);
    await expect(claimOrder(next, booster.id)).rejects.toThrow();

    await liftClaimBlock(admin.id, booster.id, "Talked to the booster");
    expect((await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: booster.id } })).claimBlockedAt).toBeNull();
    await expect(claimOrder(next, booster.id)).resolves.toBeTruthy();
  }, 60_000);
});

describe("test tool (STALL_TEST_TOOLS=1)", () => {
  it("is off without the flag and only works for the order's customer", async () => {
    const { runStallTestStep } = await import("@/lib/boosters/stall");
    const customer = await seedUser("CUSTOMER");
    const other = await seedUser("CUSTOMER");
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await claimOrder(orderId, booster.id);
    delete process.env.STALL_TEST_TOOLS;
    await expect(runStallTestStep(orderId, customer.id, "email")).rejects.toThrow(/off/);
    process.env.STALL_TEST_TOOLS = "1";
    try {
      await expect(runStallTestStep(orderId, other.id, "email")).rejects.toThrow(/not found/i);
    } finally {
      delete process.env.STALL_TEST_TOOLS;
    }
  });

  it("runs the four steps in order on a fresh order, with the real fine at the end", async () => {
    const { runStallTestStep } = await import("@/lib/boosters/stall");
    process.env.STALL_TEST_TOOLS = "1";
    try {
      const customer = await seedUser("CUSTOMER");
      const booster = await seedUser("BOOSTER");
      const { orderId } = await createPaidOrder(customer.id);
      await claimAndStart(orderId, booster.id);

      expect((await runStallTestStep(orderId, customer.id, "contact")).done).toBe(true);
      expect(await titled(booster.id, "Message Your Customer Now", orderId)).toHaveLength(1);
      expect((await runStallTestStep(orderId, customer.id, "contact")).done).toBe(false);

      await expect(runStallTestStep(orderId, customer.id, "release")).rejects.toThrow(/final warning first/);

      expect((await runStallTestStep(orderId, customer.id, "email")).done).toBe(true);
      expect(await titled(booster.id, "Order Needs Activity", orderId)).toHaveLength(1);
      expect((await runStallTestStep(orderId, customer.id, "email")).done).toBe(false);

      expect((await runStallTestStep(orderId, customer.id, "final")).done).toBe(true);
      expect(await titled(booster.id, "Order Taken Back In 1 Hour", orderId)).toHaveLength(1);

      const r = await runStallTestStep(orderId, customer.id, "release");
      expect(r.done).toBe(true);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DRAFT");
      const a = await assignmentOf(orderId, booster.id);
      expect(a.status).toBe("RELEASED");
      expect(a.endedAt!.getTime()).toBeLessThanOrEqual(Date.now()); // released at the real time
      expect(await prisma.boosterFine.count({ where: { orderId, code: "AUTO_RELEASE_IN_PROGRESS" } })).toBe(1);
      await expect(runStallTestStep(orderId, customer.id, "email")).rejects.toThrow(/no booster/);
    } finally {
      delete process.env.STALL_TEST_TOOLS;
    }
  });
});
