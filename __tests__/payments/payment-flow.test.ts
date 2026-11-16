// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phases B + C: Stripe Checkout and webhook processing, end to end against
 * an in-memory PostgreSQL (real constraints) and a fake Stripe API client
 * (real signature verification).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
  failReserve: false,
  failNotify: false,
  stripe: null as any,
  stripeConfigured: true,
}));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({
  createNotificationsForEvent: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {
    if (h.failNotify) throw new Error("notification service down");
  }),
}));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/catalog/game-services", () => ({
  getGameServiceOffer: (g: string, s: string) => h.offers.find((o) => o.gameSlug === g && o.serviceSlug === s),
}));
vi.mock("@/lib/config/checkout-options", () => ({
  getCheckoutConfig: (g: string, s: string) => h.checkouts.find((c) => c.gameSlug === g && c.serviceSlug === s),
}));
vi.mock("@/lib/stripe/server", async (orig) => {
  const actual = await orig<typeof import("@/lib/stripe/server")>();
  return {
    ...actual,
    getStripe: () => {
      if (!h.stripeConfigured) throw new actual.StripeConfigError("Stripe is not configured.");
      return h.stripe.client;
    },
  };
});
vi.mock("@/lib/finance/earnings", async (orig) => {
  const actual = await orig<typeof import("@/lib/finance/earnings")>();
  return {
    ...actual,
    reserveBoosterShare: async (...args: Parameters<typeof actual.reserveBoosterShare>) => {
      if (h.failReserve) throw new Error("simulated database failure");
      return actual.reserveBoosterShare(...args);
    },
  };
});

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { createFakeStripe, stripeEvent, WEBHOOK_SECRET } from "../support/fake-stripe";
import {
  configurePrice, createOrder, createPaidOrder, deliver, ledgerFor, rankCheckout, rankOffer, seedUser, sessionFor, startCheckout, sum,
} from "../support/payment-fixtures";
import { POST as checkoutRoute, DELETE as abandonRoute } from "@/app/api/orders/[orderId]/checkout/route";
import { CHECKOUT_HOLD_TTL_MS } from "@/lib/payments/checkout.service";
import { GET as paymentStatusRoute } from "@/app/api/orders/[orderId]/payment/route";
import { getAvailableOrders, claimOrder } from "@/lib/assignments/service";
import { dispatchOutbox } from "@/lib/payments/outbox";
import { cancelOrderByCustomer } from "@/lib/orders/cancellation.service";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string; role: string };
let other: { id: string; role: string };

const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) });
const checkoutReq = () => new Request("http://t/x", { method: "POST" }) as unknown as NextRequest;

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  other = await seedUser("CUSTOMER");
  await configurePrice(admin.id, 2500, 2500); // 100.00 EUR
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
  h.failReserve = false;
  h.failNotify = false;
  h.stripeConfigured = true;
  h.getSessionUser.mockResolvedValue(customer);
});

describe("Stripe Checkout", () => {
  it("creates a session for exactly the snapshot amount and currency", async () => {
    const order = await createOrder(customer.id);
    const res = await checkoutRoute(checkoutReq(), params(order.id));
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const call = h.stripe.state.sessionCreateCalls[0];
    expect(call.params.line_items[0].price_data).toMatchObject({ currency: "eur", unit_amount: 10000 });
    expect(call.params.metadata).toEqual({ orderId: order.id, paymentId: expect.any(String), customerId: customer.id });
    expect(call.params.payment_intent_data.metadata).toEqual(call.params.metadata);
    expect(call.options.idempotencyKey).toBe(`checkout:${order.id}:1`);
    expect(call.params.success_url).toContain("https://staging.legendsboost.test/checkout/success?orderId=");
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({ status: "OPEN", amount: 10000, currency: "EUR", attemptNumber: 1, openSlotOrderId: order.id });
  });

  it("another customer cannot start checkout for the order (404)", async () => {
    const order = await createOrder(customer.id);
    h.getSessionUser.mockResolvedValue(other);
    expect((await checkoutRoute(checkoutReq(), params(order.id))).status).toBe(404);
    expect(h.stripe.state.sessionCreateCalls).toHaveLength(0);
  });

  it.each(["BOOSTER", "ADMIN"])("%s cannot start checkout (403)", async (role) => {
    const order = await createOrder(customer.id);
    h.getSessionUser.mockResolvedValue({ id: admin.id, role });
    expect((await checkoutRoute(checkoutReq(), params(order.id))).status).toBe(403);
  });

  it("a repeated request reuses the open session (one attempt, one Stripe call)", async () => {
    const order = await createOrder(customer.id);
    const a = await (await checkoutRoute(checkoutReq(), params(order.id))).json();
    const b = await (await checkoutRoute(checkoutReq(), params(order.id))).json();
    expect(b.url).toBe(a.url);
    expect(b.reused).toBe(true);
    expect(h.stripe.state.sessionCreateCalls).toHaveLength(1);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("a Stripe failure marks the attempt FAILED, releases the slot, and a retry works", async () => {
    const order = await createOrder(customer.id);
    h.stripe.state.failNextSessionCreate = true;
    expect((await checkoutRoute(checkoutReq(), params(order.id))).status).toBe(502);
    const failed = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(failed).toMatchObject({ status: "FAILED", openSlotOrderId: null, failureCode: "checkout_session_create_failed" });
    expect(failed.failureMessage).not.toMatch(/sk_|whsec_/);

    const retry = await checkoutRoute(checkoutReq(), params(order.id));
    expect(retry.status).toBe(200);
    const attempts = await prisma.payment.findMany({ where: { orderId: order.id }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((p) => [p.attemptNumber, p.status])).toEqual([[1, "FAILED"], [2, "OPEN"]]);
  });

  it("an already-paid order cannot be paid again (409)", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    expect((await checkoutRoute(checkoutReq(), params(orderId))).status).toBe(409);
  });

  it("a cancelled order cannot be paid (409)", async () => {
    const order = await createOrder(customer.id);
    await cancelOrderByCustomer(order.id, customer.id);
    expect((await checkoutRoute(checkoutReq(), params(order.id))).status).toBe(409);
  });

  it("Stripe not configured -> 503, nothing created", async () => {
    const order = await createOrder(customer.id);
    h.stripeConfigured = false;
    expect((await checkoutRoute(checkoutReq(), params(order.id))).status).toBe(503);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("the payment status endpoint is read-only and owner-scoped", async () => {
    const order = await createOrder(customer.id);
    await startCheckout(customer.id, order.id);
    const res = await paymentStatusRoute(new Request("http://t") as any, params(order.id));
    const body = await res.json();
    expect(body).toMatchObject({ paid: false, orderStatus: "AWAITING_PAYMENT", amount: 10000, currency: "EUR", canPay: true });
    h.getSessionUser.mockResolvedValue(other);
    expect((await paymentStatusRoute(new Request("http://t") as any, params(order.id))).status).toBe(404);
  });
});

describe("webhook signature and idempotency", () => {
  it("rejects an invalid signature without storing anything", async () => {
    const before = await prisma.paymentEvent.count();
    const res = await deliver(stripeEvent("checkout.session.completed", { id: "cs_x" }), { badSignature: true });
    expect(res.status).toBe(400);
    expect(await prisma.paymentEvent.count()).toBe(before);
  });

  it("rejects a missing signature", async () => {
    expect((await deliver(stripeEvent("checkout.session.completed", { id: "cs_x" }), { noSignature: true })).status).toBe(400);
  });

  it("a valid paid session publishes the order, posts 45/55 and reserves the booster share", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const event = stripeEvent("checkout.session.completed", await sessionFor(paymentId));
    const res = await deliver(event);
    expect(res).toMatchObject({ status: 200, body: { received: true, outcome: "payment_succeeded" } });

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PENDING");
    expect(o.paymentVerifiedAt).toBeInstanceOf(Date);
    expect(o.paidPaymentId).toBe(paymentId);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p).toMatchObject({ status: "SUCCEEDED", amountReceived: 10000, openSlotOrderId: null, reviewReason: null });

    const ledger = await ledgerFor(order.id);
    expect(ledger.map((t) => [t.type, t.account, t.amount])).toEqual([
      ["CUSTOMER_PAYMENT", "CUSTOMER_PAYMENTS", 10000],
      ["PLATFORM_COMMISSION", "PLATFORM_REVENUE", 4500],
      ["BOOSTER_SHARE_RESERVED", "BOOSTER_POOL", 5500],
      // Posted by the outbox right after commit; a platform cost only.
      ["STRIPE_FEE", "STRIPE_FEES", 320],
    ]);
    const earning = await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: order.id } });
    expect(earning).toMatchObject({ status: "RESERVED", grossAmount: 5500, boosterId: null, platformFeeBps: 4500, boosterShareBps: 5500 });
    expect((await getAvailableOrders()).map((x: any) => x.id)).toContain(order.id);
    expect((await prisma.paymentEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).status).toBe("PROCESSED");
  });

  it("a duplicate event is acknowledged and posts nothing twice", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const event = stripeEvent("checkout.session.completed", await sessionFor(paymentId));
    await deliver(event);
    const again = await deliver(event);
    expect(again).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(await prisma.financialTransaction.count({ where: { orderId: order.id, account: { not: "STRIPE_FEES" } } })).toBe(3);
    expect(await prisma.boosterEarning.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("a different event for the same payment (completed + async succeeded) is idempotent", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId)));
    const res = await deliver(stripeEvent("checkout.session.async_payment_succeeded", await sessionFor(paymentId)));
    expect(res.body.outcome).toBe("already_succeeded");
    expect(await prisma.financialTransaction.count({ where: { orderId: order.id, account: { not: "STRIPE_FEES" } } })).toBe(3);
  });
});

describe("delayed payment methods", () => {
  it("completed+unpaid -> PROCESSING (not published); async success -> published", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const r1 = await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId, { payment_status: "unpaid" })));
    expect(r1.body.outcome).toBe("awaiting_async_payment");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PROCESSING");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentVerifiedAt).toBeNull();
    expect((await getAvailableOrders()).map((x: any) => x.id)).not.toContain(order.id);
    // The customer cannot cancel under a processing payment.
    await expect(cancelOrderByCustomer(order.id, customer.id)).rejects.toMatchObject({ status: 409 });

    const r2 = await deliver(stripeEvent("checkout.session.async_payment_succeeded", await sessionFor(paymentId)));
    expect(r2.body.outcome).toBe("payment_succeeded");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("async failure -> attempt FAILED, checkout hold closed (no order, no pay-later)", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId, { payment_status: "unpaid" })));
    const res = await deliver(stripeEvent("checkout.session.async_payment_failed", await sessionFor(paymentId, { payment_status: "unpaid" })));
    expect(res.body.outcome).toBe("payment_failed");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p).toMatchObject({ status: "FAILED", openSlotOrderId: null });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect([o.status, o.paymentVerifiedAt]).toEqual(["CANCELLED", null]);
    expect(await prisma.financialTransaction.count({ where: { orderId: order.id } })).toBe(0);
    await expect(startCheckout(customer.id, order.id)).rejects.toMatchObject({ status: 409 });
  });

  it("an expired Stripe session closes the hold; a hold older than the TTL cannot be paid", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    await deliver(stripeEvent("checkout.session.expired", await sessionFor(paymentId, { payment_status: "unpaid" })));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, type: "CHECKOUT_CLOSED" } })).toBe(1);

    const old = await createOrder(customer.id);
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - CHECKOUT_HOLD_TTL_MS - 60_000) } });
    expect((await checkoutRoute(checkoutReq(), params(old.id))).status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("CANCELLED");
  });

  it("cancelling on the Stripe page closes the hold (owner only, idempotent)", async () => {
    const order = await createOrder(customer.id);
    await startCheckout(customer.id, order.id);
    h.getSessionUser.mockResolvedValue(other);
    expect((await abandonRoute(checkoutReq(), params(order.id))).status).toBe(404);
    h.getSessionUser.mockResolvedValue(customer);
    expect(await (await abandonRoute(checkoutReq(), params(order.id))).json()).toEqual({ closed: true });
    expect(await (await abandonRoute(checkoutReq(), params(order.id))).json()).toEqual({ closed: false });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("CANCELLED");
    const p = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(p).toMatchObject({ status: "CANCELED", openSlotOrderId: null });
  });

  it("a paid order is never closed by the hold logic", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    expect(await (await abandonRoute(checkoutReq(), params(orderId))).json()).toEqual({ closed: false });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
  });

  it("payment_intent.payment_failed records the reason without closing the session", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const res = await deliver(
      stripeEvent("payment_intent.payment_failed", {
        id: "pi_failed_1",
        object: "payment_intent",
        metadata: { paymentId, orderId: order.id },
        last_payment_error: { code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." },
      })
    );
    expect(res.body.outcome).toBe("payment_attempt_failed");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p).toMatchObject({ status: "OPEN", failureCode: "insufficient_funds" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentVerifiedAt).toBeNull();
  });

  it("an expired session releases the slot", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    await deliver(stripeEvent("checkout.session.expired", await sessionFor(paymentId, { payment_status: "unpaid" })));
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "EXPIRED", openSlotOrderId: null });
  });
});

describe("money that cannot be applied is never published", () => {
  async function paidWith(overrides: Record<string, unknown>) {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const res = await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId, overrides)));
    return { order, paymentId, res };
  }
  async function expectUnapplied(orderId: string, paymentId: string, reason: string, amount: number) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect([o.status, o.paymentVerifiedAt, o.paidPaymentId]).toEqual(["AWAITING_PAYMENT", null, null]);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p).toMatchObject({ status: "SUCCEEDED", reviewReason: reason });
    const ledger = await ledgerFor(orderId);
    expect(ledger.map((t) => [t.account, t.amount])).toEqual([["CUSTOMER_PAYMENTS", amount]]);
    expect(await prisma.boosterEarning.count({ where: { orderId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `payment-review:${paymentId}:${reason}` } })).toBe(1);
  }

  it("amount mismatch", async () => {
    const { order, paymentId, res } = await paidWith({ amount_total: 100 });
    expect(res.status).toBe(200);
    await expectUnapplied(order.id, paymentId, "AMOUNT_MISMATCH", 100);
  });

  it("currency mismatch", async () => {
    const { order, paymentId } = await paidWith({ currency: "usd" });
    await expectUnapplied(order.id, paymentId, "CURRENCY_MISMATCH", 10000);
  });

  it("wrong order metadata", async () => {
    const someoneElse = await createOrder(customer.id);
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const s = await sessionFor(paymentId);
    await deliver(stripeEvent("checkout.session.completed", { ...s, metadata: { ...s.metadata, orderId: someoneElse.id } }));
    await expectUnapplied(order.id, paymentId, "METADATA_MISMATCH", 10000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: someoneElse.id } })).paymentVerifiedAt).toBeNull();
  });

  it("a second successful payment for an already-paid order is flagged, not applied", async () => {
    const order = await createOrder(customer.id);
    const first = await startCheckout(customer.id, order.id);
    // Simulate the first session expiring after being paid elsewhere: open a second attempt.
    await prisma.payment.update({ where: { id: first.paymentId }, data: { checkoutExpiresAt: new Date(Date.now() - 1000) } });
    const second = await startCheckout(customer.id, order.id);
    expect(second.paymentId).not.toBe(first.paymentId);
    await deliver(stripeEvent("checkout.session.completed", await sessionFor(second.paymentId)));
    await deliver(stripeEvent("checkout.session.completed", await sessionFor(first.paymentId)));
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.paidPaymentId).toBe(second.paymentId);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: first.paymentId } })).reviewReason).toBe("DUPLICATE_PAYMENT");
    expect(sum(await ledgerFor(order.id), (t) => t.account === "PLATFORM_REVENUE")).toBe(4500);
  });

  it("an unknown session is ignored", async () => {
    const res = await deliver(stripeEvent("checkout.session.completed", { id: "cs_unknown", object: "checkout.session", payment_status: "paid", metadata: {} }));
    expect(res.body.outcome).toBe("unknown_session");
  });

  it("a live-mode event is ignored while live mode is disabled", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const event = { ...stripeEvent("checkout.session.completed", await sessionFor(paymentId)), livemode: true };
    const res = await deliver(event);
    expect(res.body.outcome).toBe("livemode_event_ignored");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentVerifiedAt).toBeNull();
  });
});

describe("failure handling", () => {
  it("a database failure rolls everything back, keeps the event and succeeds on retry", async () => {
    const order = await createOrder(customer.id);
    const { paymentId } = await startCheckout(customer.id, order.id);
    const event = stripeEvent("checkout.session.completed", await sessionFor(paymentId));
    h.failReserve = true;
    const first = await deliver(event);
    expect(first.status).toBe(500);
    const row = await prisma.paymentEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("simulated database failure");
    // Rolled back: nothing published or posted, payment untouched.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentVerifiedAt).toBeNull();
    expect(await prisma.financialTransaction.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("OPEN");

    h.failReserve = false;
    const retry = await deliver(event); // Stripe's automatic retry
    expect(retry).toMatchObject({ status: 200, body: { outcome: "payment_succeeded" } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await prisma.financialTransaction.count({ where: { orderId: order.id, account: { not: "STRIPE_FEES" } } })).toBe(3);
  });

  it("a notification failure after payment never undoes the payment", async () => {
    h.failNotify = true;
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
    const notify = await prisma.outboxEvent.findUniqueOrThrow({ where: { dedupeKey: `payment-succeeded:${paymentId}` } });
    expect(notify.status).toBe("PENDING");
    expect(notify.lastError).toContain("notification service down");
    // Recovers once the service is back.
    h.failNotify = false;
    await prisma.outboxEvent.update({ where: { id: notify.id }, data: { availableAt: new Date() } });
    await dispatchOutbox();
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: notify.id } })).status).toBe("DONE");
    // The "Order confirmed" email is queued once with the payment.
    expect(await prisma.outboxEvent.count({ where: { type: "EMAIL_ORDER_CONFIRMED", dedupeKey: `order-confirmed-email:${orderId}` } })).toBe(1);
  });

  it("the Stripe fee is recorded as a platform cost, never charged to the booster", async () => {
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    await dispatchOutbox();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).stripeFeeAmount).toBe(320);
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.account === "STRIPE_FEES")).toBe(320);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(5500);
  });
});

describe("marketplace integration", () => {
  it("unpaid orders stay invisible; paid orders become claimable atomically", async () => {
    const unpaid = await createOrder(customer.id);
    const { orderId } = await createPaidOrder(customer.id);
    const listed = (await getAvailableOrders()).map((x: any) => x.id);
    expect(listed).toContain(orderId);
    expect(listed).not.toContain(unpaid.id);

    const b1 = await seedUser("BOOSTER");
    const b2 = await seedUser("BOOSTER");
    const results = await Promise.allSettled([claimOrder(orderId, b1.id), claimOrder(orderId, b2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.orderBoosterAssignment.count({ where: { orderId, activeOrderId: orderId } })).toBe(1);
    await expect(claimOrder(unpaid.id, b1.id)).rejects.toThrow();
  });
});
