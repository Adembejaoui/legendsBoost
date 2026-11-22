// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Customer header actions (client PDF 2026-11-21) against an in-memory
 * PostgreSQL with all migrations: "Change booster" requests reviewed by an
 * admin, and "Poke booster" emails limited to one per hour.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
  stripe: null as any,
  emails: [] as any[],
}));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/realtime/live", () => ({ signalPool: vi.fn(async () => {}), livePool: vi.fn(async () => {}) }));
vi.mock("@/lib/email/send", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(async (m: any) => {
    h.emails.push(m);
    return { sent: true };
  }),
}));
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
import { configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser } from "../support/payment-fixtures";
import { decideBoosterChange, requestBoosterChange, withdrawBoosterChange } from "@/lib/orders/booster-change.service";
import { pokeBooster, POKE_COOLDOWN_MS } from "@/lib/orders/poke.service";
import { dispatchOutbox } from "@/lib/payments/outbox";
import { getBoosterAssignments, setCustomerOrderPaused } from "@/lib/assignments/service";
import { sendOrderPausedEmail } from "@/lib/email/order-paused";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string; role: string };
let other: { id: string; role: string };
let booster: { id: string };

/** A paid order held by `booster` (IN_PROGRESS). */
async function heldOrder() {
  const { orderId } = await createPaidOrder(customer.id);
  await prisma.order.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
  const a = await prisma.orderBoosterAssignment.create({
    data: { orderId, boosterId: booster.id, assignedById: booster.id, status: "IN_PROGRESS", activeOrderId: orderId, startedAt: new Date() },
  });
  return { orderId, assignmentId: a.id };
}

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  other = await seedUser("CUSTOMER");
  booster = await seedUser("BOOSTER");
  await configurePrice(admin.id, 2500, 2500);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
  h.getSessionUser.mockResolvedValue(customer);
  h.emails.length = 0;
});

describe("Change booster", () => {
  it("only the owner of an order with a booster can ask, once at a time; the reason is optional", async () => {
    const { orderId: pending } = await createPaidOrder(customer.id);
    await expect(requestBoosterChange(customer.id, pending, "My booster is not playing at all")).rejects.toMatchObject({ status: 409 });

    const { orderId } = await heldOrder();
    await expect(requestBoosterChange(other.id, orderId, "My booster is not playing at all")).rejects.toMatchObject({ status: 404 });
    await expect(requestBoosterChange(customer.id, orderId, "x".repeat(1001))).rejects.toMatchObject({ status: 400 });
    const r = await requestBoosterChange(customer.id, orderId, "My booster is not playing at all");
    expect(r).toMatchObject({ status: "REQUESTED", boosterId: booster.id });
    await expect(requestBoosterChange(customer.id, orderId, "Asking again for a new booster")).rejects.toMatchObject({ status: 409 });

    await withdrawBoosterChange(customer.id, orderId);
    // Client PDF 2026-11-22: no reason needed.
    expect(await requestBoosterChange(customer.id, orderId, undefined)).toMatchObject({ status: "REQUESTED", reason: "No reason given" });
  });

  it("reject keeps the booster and needs a note; only admins decide, once", async () => {
    const { orderId, assignmentId } = await heldOrder();
    const r = await requestBoosterChange(customer.id, orderId, "My booster is not playing at all");
    await expect(decideBoosterChange(customer.id, r.id, { decision: "approve" })).rejects.toMatchObject({ status: 403 });
    await expect(decideBoosterChange(admin.id, r.id, { decision: "reject" })).rejects.toMatchObject({ status: 400 });
    expect(await decideBoosterChange(admin.id, r.id, { decision: "reject", note: "Your booster played 6 games today." })).toMatchObject({ status: "REJECTED" });
    await expect(decideBoosterChange(admin.id, r.id, { decision: "approve" })).rejects.toMatchObject({ status: 409 });
    expect((await prisma.orderBoosterAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe("IN_PROGRESS");
  });

  it("approve releases the booster and puts the order back on the marketplace", async () => {
    const { orderId, assignmentId } = await heldOrder();
    const r = await requestBoosterChange(customer.id, orderId, "My booster is not playing at all");
    expect(await decideBoosterChange(admin.id, r.id, { decision: "approve", note: "A new booster will take over." })).toMatchObject({
      status: "APPROVED",
      released: true,
    });
    expect((await prisma.orderBoosterAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe("RELEASED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
  });

  it("the released order leaves the former booster's order lists at once (booster list test 2026-11-22)", async () => {
    const { orderId } = await heldOrder();
    const before = await getBoosterAssignments(booster.id, "all");
    expect(before.some((a) => a.orderId === orderId)).toBe(true);
    const r = await requestBoosterChange(customer.id, orderId, "My booster is not playing at all");
    await decideBoosterChange(admin.id, r.id, { decision: "approve", note: "A new booster will take over." });
    for (const filter of ["all", "history", "active"] as const) {
      expect((await getBoosterAssignments(booster.id, filter)).some((a) => a.orderId === orderId)).toBe(false);
    }
    // The admin still has the order and its history.
    expect(await prisma.orderBoosterAssignment.count({ where: { orderId, boosterId: booster.id, status: "RELEASED" } })).toBe(1);
  });
});

describe("Pause order email (sound test 2026-11-22)", () => {
  it("emails the assigned booster when the customer pauses, not when they resume", async () => {
    const { orderId } = await heldOrder();
    h.emails.length = 0;
    await setCustomerOrderPaused(orderId, customer.id, "pause");
    await dispatchOutbox({ limit: 10 });
    const mails = h.emails.filter((m) => m.to === `${booster.id}@t.test`);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/^The customer paused order #/);
    expect(mails[0].text).toMatch(/^Stop boosting now/);
    expect(mails[0].action).toMatchObject({ label: "Open the order" });
    expect(mails[0].action.url).toContain(`/dashboard/${orderId}`);

    h.emails.length = 0;
    await setCustomerOrderPaused(orderId, customer.id, "resume");
    await dispatchOutbox({ limit: 10 });
    expect(h.emails).toHaveLength(0);
  });

  it("a repeated pause click sends one email", async () => {
    const { orderId } = await heldOrder();
    h.emails.length = 0;
    await setCustomerOrderPaused(orderId, customer.id, "pause");
    await setCustomerOrderPaused(orderId, customer.id, "pause");
    await dispatchOutbox({ limit: 10 });
    expect(h.emails.filter((m) => m.to === `${booster.id}@t.test`)).toHaveLength(1);
  });

  it("no email when the order was resumed before it went out", async () => {
    const { orderId } = await heldOrder(); // in progress, i.e. not paused (any more)
    h.emails.length = 0;
    await sendOrderPausedEmail(orderId, booster.id);
    expect(h.emails).toHaveLength(0);
  });
});

describe("Poke booster", () => {
  it("needs a booster on the order and the owner", async () => {
    const { orderId: pending } = await createPaidOrder(customer.id);
    await expect(pokeBooster(customer.id, pending)).rejects.toMatchObject({ status: 409 });
    const { orderId } = await heldOrder();
    await expect(pokeBooster(other.id, orderId)).rejects.toMatchObject({ status: 404 });
  });

  it("emails the booster once per hour with the order chat link", async () => {
    const { orderId } = await heldOrder();
    const t0 = new Date();
    const r = await pokeBooster(customer.id, orderId, t0);
    expect(r.nextPokeAt.getTime()).toBe(t0.getTime() + POKE_COOLDOWN_MS);
    await dispatchOutbox({ limit: 10 });
    const mail = h.emails.find((m) => m.to === `${booster.id}@t.test`);
    expect(mail?.subject).toMatch(/^Your customer needs your attention on order #/);
    expect(mail?.text).toBe("Please open the order chat to check in with your customer.");
    expect(mail?.action).toMatchObject({ label: "Open order chat" });
    expect(mail?.action.url).toContain(`/dashboard/${orderId}?view=chat`);

    await expect(pokeBooster(customer.id, orderId, new Date(t0.getTime() + 10 * 60_000))).rejects.toMatchObject({ status: 429 });
    await expect(pokeBooster(customer.id, orderId, new Date(t0.getTime() + POKE_COOLDOWN_MS + 1000))).resolves.toBeTruthy();
  });
});

describe("admin alert (client PDF 2026-11-22)", () => {
  it("a booster change request notifies every admin with the order, for the alert and its sound", async () => {
    const { orderId } = await heldOrder();
    const r = await requestBoosterChange(customer.id, orderId, undefined);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { dedupeKey: `booster-change:${r.id}` } });
    expect(event.payload).toMatchObject({ notification: "BOOSTER_CHANGE_REQUESTED", recipients: "ADMINS", orderId });
    const { NOTIFICATION_TITLES, NOTIFICATION_MESSAGES } = await import("@/lib/notifications/types");
    expect(NOTIFICATION_TITLES.BOOSTER_CHANGE_REQUESTED).toBe("Booster Change Requested");
    expect(NOTIFICATION_MESSAGES.BOOSTER_CHANGE_REQUESTED({ orderId })).toMatch(/asked for a different booster/);
  });
});
