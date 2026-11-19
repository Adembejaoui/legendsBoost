// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 1 against an in-memory PostgreSQL (real constraints, all migrations):
 * coupons (platform-funded), the required risk notice, and customer
 * cancellation requests reviewed by an admin (with a Stripe refund).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
  stripe: null as any,
}));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
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

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser } from "../support/payment-fixtures";
import { createOrderForCustomer, OrderCreationError } from "@/lib/orders/order-creation.service";
import { buildServerQuote } from "@/lib/pricing/service";
import { createCoupon, setCouponActive } from "@/lib/pricing/coupon-admin.service";
import {
  CancellationRequestError,
  decideCancellation,
  requestCancellation,
  withdrawCancellation,
} from "@/lib/orders/cancellation-request.service";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string; role: string };
let other: { id: string; role: string };

// Gold IV -> Gold I = base 25.00 + 3 x 25.00 = 100.00 EUR; commission 45 / 55.
const request = (extra: Record<string, unknown> = {}) => ({
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "i" } },
  selectedOptions: [],
  riskAccepted: true as const,
  ...extra,
});
const order = (customerId: string, extra: Record<string, unknown> = {}) =>
  createOrderForCustomer(customerId, request(extra) as any, uid("idem-key-phase1"));

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  other = await seedUser("CUSTOMER");
  await configurePrice(admin.id, 2500, 2500);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
  h.getSessionUser.mockResolvedValue(customer);
});

describe("risk notice", () => {
  // Client decision 2026-11-19: no risk checkbox at checkout any more.
  it("an order can be created without it; an acceptance sent anyway is still stored with its version", async () => {
    const { order: without } = await order(customer.id, { riskAccepted: undefined });
    const plain = await prisma.order.findUniqueOrThrow({ where: { id: without.id } });
    expect(plain.riskDisclosureAcceptedAt).toBeNull();
    const { order: o } = await order(customer.id);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.riskDisclosureAcceptedAt).toBeInstanceOf(Date);
    expect(row.riskDisclosureVersion).toBe("2026-11-14");
  });
});

describe("coupons", () => {
  it("a percent code lowers the price; the booster share is unchanged (platform-funded)", async () => {
    await createCoupon(admin.id, { code: "ten-off", type: "PERCENT", percent: 10, perCustomerLimit: 5 });
    const plain = await buildServerQuote(request() as any);
    const q = await buildServerQuote(request({ couponCode: "TEN-OFF" }) as any, undefined, { customerId: customer.id });
    expect(q.coupon).toMatchObject({ code: "TEN-OFF", applied: true });
    expect(q.quote.discountAmount).toBe(1000);
    expect(q.quote.totalAmount).toBe(9000);
    expect(q.quote.commission.boosterShareAmount).toBe(plain.quote.commission.boosterShareAmount);
    expect(q.quote.commission.platformFeeAmount + q.quote.commission.boosterShareAmount).toBe(q.quote.totalAmount);

    const { order: o } = await order(customer.id, { couponCode: "ten-off" });
    const snap = await prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(snap).toMatchObject({ couponCode: "TEN-OFF", discountAmount: 1000, totalAmount: 9000, boosterShareAmount: 5500, platformFeeAmount: 3500 });
  });

  it("a discount is capped at the platform fee, so the booster is never underpaid", async () => {
    await createCoupon(admin.id, { code: "FREEBIE", type: "PERCENT", percent: 100 });
    const q = await buildServerQuote(request({ couponCode: "FREEBIE" }) as any);
    expect(q.quote.discountAmount).toBe(4500);
    expect(q.quote.totalAmount).toBe(5500);
    expect(q.quote.commission).toMatchObject({ boosterShareAmount: 5500, platformFeeAmount: 0 });
  });

  it("per-customer limit, unknown, inactive and expired codes", async () => {
    await createCoupon(admin.id, { code: "ONCE", type: "FIXED", amount: "5", currency: "EUR" });
    await order(customer.id, { couponCode: "ONCE" });
    await expect(order(customer.id, { couponCode: "ONCE" })).rejects.toMatchObject({ status: 409, message: "You have already used this code." });
    // Another customer can still use it.
    expect((await order(other.id, { couponCode: "ONCE" })).order.id).toBeTruthy();

    expect((await buildServerQuote(request({ couponCode: "NOPE" }) as any)).coupon).toMatchObject({ applied: false, reason: "This code does not exist." });

    const c = await createCoupon(admin.id, { code: "OFFNOW", type: "PERCENT", percent: 5 });
    await setCouponActive(admin.id, c.id, false);
    const off = await buildServerQuote(request({ couponCode: "OFFNOW" }) as any);
    expect(off.coupon?.applied).toBe(false);
    expect(off.quote.discountAmount).toBe(0);

    await createCoupon(admin.id, { code: "OLD", type: "PERCENT", percent: 5, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(order(customer.id, { couponCode: "OLD" })).rejects.toBeInstanceOf(OrderCreationError);
  });

  it("validates admin input and refuses duplicate codes", async () => {
    await expect(createCoupon(admin.id, { code: "BAD", type: "FIXED" })).rejects.toThrow(/amount/);
    await createCoupon(admin.id, { code: "DUPE", type: "PERCENT", percent: 5 });
    await expect(createCoupon(admin.id, { code: "dupe", type: "PERCENT", percent: 5 })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.auditLog.count({ where: { action: "COUPON_CREATED" } })).toBeGreaterThan(0);
  });
});

describe("cancellation requests (admin-reviewed)", () => {
  it("customer asks; only one open request; another customer gets 404; unpaid orders cannot", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    await expect(requestCancellation(other.id, orderId, "Please cancel this order now")).rejects.toMatchObject({ status: 404 });
    await expect(requestCancellation(customer.id, orderId, "short")).rejects.toMatchObject({ status: 400 });
    const r = await requestCancellation(customer.id, orderId, "Changed my mind about this boost");
    expect(r.status).toBe("REQUESTED");
    await expect(requestCancellation(customer.id, orderId, "Asking a second time please")).rejects.toMatchObject({ status: 409 });

    const { order: unpaid } = await order(customer.id);
    await expect(requestCancellation(customer.id, unpaid.id, "Cancel my unpaid checkout")).rejects.toBeInstanceOf(CancellationRequestError);
  });

  it("withdraw, then ask again", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    await requestCancellation(customer.id, orderId, "Changed my mind about this boost");
    await withdrawCancellation(customer.id, orderId);
    expect((await requestCancellation(customer.id, orderId, "Actually yes, please cancel")).status).toBe("REQUESTED");
  });

  it("admin rejects with a note: order unchanged", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const r = await requestCancellation(customer.id, orderId, "Changed my mind about this boost");
    await expect(decideCancellation(admin.id, r.id, { decision: "reject" })).rejects.toMatchObject({ status: 400 });
    expect(await decideCancellation(admin.id, r.id, { decision: "reject", note: "Your boost is almost done." })).toMatchObject({ status: "REJECTED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
    await expect(decideCancellation(admin.id, r.id, { decision: "reject", note: "again" })).rejects.toMatchObject({ status: 409 });
  });

  it("admin approves: order cancelled and refunded through Stripe; only an admin can decide", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const r = await requestCancellation(customer.id, orderId, "Changed my mind about this boost");
    await expect(decideCancellation(customer.id, r.id, { decision: "approve", refundAmount: 10000 })).rejects.toMatchObject({ status: 403 });
    await expect(decideCancellation(admin.id, r.id, { decision: "approve", refundAmount: 10001 })).rejects.toMatchObject({ status: 400 });

    const res = await decideCancellation(admin.id, r.id, { decision: "approve", refundAmount: 10000, note: "Refunded in full." });
    expect(res).toMatchObject({ status: "APPROVED", refundError: null });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
    const row = await prisma.orderCancellationRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "APPROVED", refundAmount: 10000, decidedById: admin.id });
    expect(row.refundId).toBeTruthy();
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: row.refundId! } })).toMatchObject({ amount: 10000 });
  });
});
