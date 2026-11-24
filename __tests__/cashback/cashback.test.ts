// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Customer cashback (2026-11-24): pure balance rules, then the whole flow
 * against an in-memory PostgreSQL with every migration: earn on completion,
 * quote and reserve at order creation, release when the checkout closes,
 * spend on payment, refunds, expiry, the double-spend race, the append-only
 * guard and the ledger staying balanced.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
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

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { createFakeStripe, stripeEvent, WEBHOOK_SECRET } from "../support/fake-stripe";
import { claimAndStart, configurePrice, createPaidOrder, deliver, rankCheckout, rankOffer, seedUser, sessionFor, setConfig, startCheckout } from "../support/payment-fixtures";
import { completeAssignment } from "@/lib/assignments/service";
import { requestRefund } from "@/lib/finance/refunds";
import { abandonCheckout } from "@/lib/payments/checkout.service";
import { createOrderForCustomer } from "@/lib/orders/order-creation.service";
import { buildServerQuote } from "@/lib/pricing/service";
import { adjustCashback, availableCashback, expireCashback } from "@/lib/cashback/service";
import { cashbackForOrder, cashbackState, spendExpiry, type CashbackEntryLike } from "@/lib/cashback/state";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
const DAY = 86_400_000;

/** Gold IV -> Gold I rank boost: 100.00 EUR with the fixture price (45/55). */
const request = (extra: Record<string, unknown> = {}) =>
  ({
    gameSlug: "league-of-legends",
    serviceSlug: "rank-boost",
    configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "i" } },
    selectedOptions: [],
    riskAccepted: true,
    ...extra,
  }) as any;

async function completeOrder(orderId: string) {
  const booster = await seedUser("BOOSTER");
  const { assignment } = await claimAndStart(orderId, booster.id);
  await completeAssignment(assignment.id, booster.id, "BOOSTER");
}

async function payOrder(customerId: string, orderId: string) {
  const { paymentId } = await startCheckout(customerId, orderId);
  const res = await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId)));
  expect(res.status).toBe(200);
  return paymentId;
}

const ledgerSum = async (where: Record<string, unknown>) =>
  (await prisma.financialTransaction.aggregate({ _sum: { amount: true }, where })) ._sum.amount ?? 0;

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
  h.getSessionUser.mockResolvedValue(admin);
});

/* ------------------------------------------------------------------ */

describe("balance rules (pure)", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const at = (days: number) => new Date(t0.getTime() + days * DAY);
  const e = (id: string, kind: CashbackEntryLike["kind"], amount: number, day: number, expiresDay: number | null = null, lotId: string | null = null): CashbackEntryLike => ({
    id, kind, amount, createdAt: at(day), expiresAt: expiresDay === null ? null : at(expiresDay), lotId,
  });

  it("spends the credit that expires first; expired credit is not available", () => {
    const entries = [e("a", "EARN", 500, 0, 100), e("b", "EARN", 300, 1, 50), e("s", "SPEND", -400, 2)];
    const st = cashbackState(entries, at(3));
    expect(st.balance).toBe(400);
    expect(st.lots.find((l) => l.id === "b")!.remaining).toBe(0); // expires first: used first
    expect(st.lots.find((l) => l.id === "a")!.remaining).toBe(400);
    expect(cashbackState(entries, at(101)).available).toBe(0); // everything past expiry
  });

  it("a debt (cashback taken back after a refund) is paid by the next credit", () => {
    const st = cashbackState([e("a", "EARN", 500, 0, 100), e("s", "SPEND", -500, 1), e("r", "REVERSE", -200, 2), e("c", "ADJUST", 300, 3, 100)], at(4));
    expect(st.balance).toBe(100);
    expect(st.debt).toBe(0);
    expect(st.available).toBe(100);
  });

  it("an EXPIRE entry closes only its lot and never creates a debt", () => {
    const st = cashbackState([e("a", "EARN", 500, 0, 10), e("x", "EXPIRE", -500, 11, null, "a"), e("b", "EARN", 100, 12, 100)], at(13));
    expect(st).toMatchObject({ balance: 100, available: 100, debt: 0 });
  });

  it("a spend keeps the latest expiry of the credit it used", () => {
    const st = cashbackState([e("a", "EARN", 100, 0, 10), e("b", "EARN", 100, 0, 20)], at(1));
    expect(spendExpiry(st, 150, at(1))?.getTime()).toBe(at(20).getTime());
    expect(spendExpiry(st, 50, at(1))?.getTime()).toBe(at(10).getTime());
  });

  it("an order can use at most 50% and never more than the platform fee left", () => {
    expect(cashbackForOrder(10_000, 10_000, 5000, 4500)).toBe(4500);
    expect(cashbackForOrder(10_000, 10_000, 5000, 9000)).toBe(5000);
    expect(cashbackForOrder(300, 10_000, 5000, 4500)).toBe(300);
    expect(cashbackForOrder(300, 10_000, 5000, 0)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe("cashback flow", () => {
  it("earn 5% on completion, use it at checkout, get it back when the checkout is not paid", async () => {
    const customer = await seedUser("CUSTOMER");
    const { orderId: a } = await createPaidOrder(customer.id);
    await completeOrder(a);

    const earn = await prisma.cashbackEntry.findUniqueOrThrow({ where: { idempotencyKey: `cashback:earn:${a}` } });
    expect(earn).toMatchObject({ kind: "EARN", amount: 500, currency: "EUR", rateBps: 500 });
    expect(earn.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 179 * DAY);
    expect(await ledgerSum({ orderId: a, account: "CUSTOMER_CREDIT" })).toBe(500);
    expect(await ledgerSum({ orderId: a, type: "CASHBACK_EARNED", account: "PLATFORM_REVENUE" })).toBe(-500);

    // The completed order page shows it to the customer (order complete modal), never to others.
    const { getOrderWorkspace } = await import("@/lib/orders/workspace-data");
    const ws = await getOrderWorkspace(a, { id: customer.id, email: null, role: "CUSTOMER" } as any);
    expect(ws?.feedback.cashback).toMatchObject({ earned: 500, currency: "EUR", available: 500 });
    expect(ws?.feedback.canReview).toBe(true);

    // Quote: the balance is shown; used only when asked.
    const plain = await buildServerQuote(request(), prisma, { customerId: customer.id });
    expect(plain.cashback).toMatchObject({ available: 500, applied: 0 });
    expect(plain.cashbackEarn).toBe(500);
    const q = await buildServerQuote(request({ useCashback: true }), prisma, { customerId: customer.id });
    expect(q.quote).toMatchObject({ cashbackAmount: 500, discountAmount: 500, totalAmount: 9500 });
    expect(q.quote.commission.boosterShareAmount).toBe(5500); // booster share untouched

    // A visitor sees no balance.
    expect((await buildServerQuote(request({ useCashback: true }), prisma, {})).quote.cashbackAmount).toBe(0);

    const { order: b } = await createOrderForCustomer(customer.id, request({ useCashback: true, expectedTotal: { amount: 9500, currency: "EUR" } }), uid("idem-cashback-b"));
    expect(b.pricingSnapshot).toMatchObject({ cashbackAmount: 500, totalAmount: 9500 });
    expect(await availableCashback(customer.id, "EUR")).toBe(0);
    // Not posted to the ledger while unpaid.
    expect(await ledgerSum({ orderId: b.id, account: "CUSTOMER_CREDIT" })).toBe(0);

    await abandonCheckout(customer.id, b.id);
    expect(await availableCashback(customer.id, "EUR")).toBe(500);
    const release = await prisma.cashbackEntry.findUniqueOrThrow({ where: { idempotencyKey: `cashback:release:${b.id}` } });
    expect(release.expiresAt?.getTime()).toBe(earn.expiresAt!.getTime()); // same expiry: no refresh by abandoning
  });

  it("paid with cashback: spent in the ledger; a refund gives back that share and takes back earned cashback", async () => {
    const customer = await seedUser("CUSTOMER");
    const { orderId: a } = await createPaidOrder(customer.id);
    await completeOrder(a); // +500

    const { order: d } = await createOrderForCustomer(customer.id, request({ useCashback: true }), uid("idem-cashback-d"));
    const paymentId = await payOrder(customer.id, d.id);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).amount).toBe(9500);
    expect(await ledgerSum({ orderId: d.id, type: "CASHBACK_SPENT", account: "CUSTOMER_CREDIT" })).toBe(-500);
    expect(await ledgerSum({ orderId: d.id, type: "CASHBACK_SPENT", account: "PLATFORM_REVENUE" })).toBe(500);

    // Half of D refunded: half of the cashback used comes back.
    await requestRefund(admin.id, { orderId: d.id, amount: 4750, reason: "Half", idempotencyKey: uid("refund-key-cb-1") });
    expect(await availableCashback(customer.id, "EUR")).toBe(250);

    // A fully refunded: its 500 earned is taken back (leaves a debt of 250).
    await requestRefund(admin.id, { orderId: a, amount: 10_000, reason: "Full", idempotencyKey: uid("refund-key-cb-2") });
    expect(await availableCashback(customer.id, "EUR")).toBe(0);
    const entries = await prisma.cashbackEntry.findMany({ where: { userId: customer.id } });
    expect(entries.reduce((s, x) => s + x.amount, 0)).toBe(-250);
    // Ledger = the customer's history (no unpaid reservation here).
    expect(await ledgerSum({ account: "CUSTOMER_CREDIT", orderId: { in: [a, d.id] } })).toBe(-250);
  });

  it("two checkouts at the same time can never spend the same cashback", async () => {
    const customer = await seedUser("CUSTOMER");
    await adjustCashback({ adminId: admin.id, userId: customer.id, currency: "EUR", amount: 500, note: "Welcome gift" });
    const results = await Promise.allSettled([
      createOrderForCustomer(customer.id, request({ useCashback: true, expectedTotal: { amount: 9500, currency: "EUR" } }), uid("idem-race-1")),
      createOrderForCustomer(customer.id, request({ useCashback: true, expectedTotal: { amount: 9500, currency: "EUR" } }), uid("idem-race-2")),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toMatchObject({ status: 409 });
    expect(await availableCashback(customer.id, "EUR")).toBe(0);
    expect(await prisma.cashbackEntry.count({ where: { userId: customer.id, kind: "SPEND" } })).toBe(1);
  });

  it("expired credit is closed once, in the ledger too", async () => {
    const customer = await seedUser("CUSTOMER");
    await adjustCashback({ adminId: admin.id, userId: customer.id, currency: "EUR", amount: 700, note: "Support gesture" });
    const later = new Date(Date.now() + 181 * DAY);
    expect(await availableCashback(customer.id, "EUR", prisma, later)).toBe(0);
    await expireCashback(later);
    await expireCashback(later); // idempotent
    const expired = await prisma.cashbackEntry.findMany({ where: { userId: customer.id, kind: "EXPIRE" } });
    expect(expired.map((x) => x.amount)).toEqual([-700]);
    const sum = (await prisma.cashbackEntry.aggregate({ _sum: { amount: true }, where: { userId: customer.id } }))._sum.amount;
    expect(sum).toBe(0);
  });

  it("admin changes need a reason and cannot remove more than the balance; only customers have cashback", async () => {
    const customer = await seedUser("CUSTOMER");
    await expect(adjustCashback({ adminId: admin.id, userId: customer.id, currency: "EUR", amount: 100, note: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(adjustCashback({ adminId: admin.id, userId: customer.id, currency: "EUR", amount: -1, note: "Remove" })).rejects.toMatchObject({ status: 400 });
    const booster = await seedUser("BOOSTER");
    await expect(adjustCashback({ adminId: admin.id, userId: booster.id, currency: "EUR", amount: 100, note: "x" })).rejects.toMatchObject({ status: 400 });
    await adjustCashback({ adminId: admin.id, userId: customer.id, currency: "EUR", amount: 300, note: "Goodwill" });
    expect(await prisma.financialAuditLog.count({ where: { action: "CASHBACK_ADJUSTED", entityId: customer.id } })).toBe(1);
  });

  it("history is append-only: the database refuses updates and deletes", async () => {
    const customer = await seedUser("CUSTOMER");
    await adjustCashback({ adminId: admin.id, userId: customer.id, currency: "EUR", amount: 100, note: "Test" });
    const row = await prisma.cashbackEntry.findFirstOrThrow({ where: { userId: customer.id } });
    // Inside transactions: the test database helper recovers cleanly from a failed statement there.
    await expect(prisma.$transaction((tx) => tx.cashbackEntry.update({ where: { id: row.id }, data: { amount: 999_999 } }))).rejects.toThrow(/append-only/);
    await expect(prisma.$transaction((tx) => tx.cashbackEntry.delete({ where: { id: row.id } }))).rejects.toThrow(/append-only/);
    // The sign rule is enforced too.
    await expect(
      prisma.$transaction((tx) => tx.cashbackEntry.create({ data: { userId: customer.id, currency: "EUR", kind: "EARN", amount: -5, idempotencyKey: uid("bad") } }))
    ).rejects.toThrow();
  });

  it("the ledger stays balanced: customer money = platform + booster share + cashback owed", async () => {
    const accounts = await prisma.financialTransaction.groupBy({ by: ["account"], _sum: { amount: true } });
    const total = (a: string) => accounts.find((x) => x.account === a)?._sum.amount ?? 0;
    expect(total("CUSTOMER_PAYMENTS")).toBe(
      total("PLATFORM_REVENUE") + total("BOOSTER_POOL") + total("BOOSTER_PAYABLE") + total("BOOSTER_PAYOUTS") + total("CUSTOMER_CREDIT")
    );
  });
});
