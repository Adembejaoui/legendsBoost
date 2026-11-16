// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phases D-F: ledger, booster earnings, manual payouts, refunds and disputes,
 * end to end against an in-memory PostgreSQL and a fake Stripe client.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/catalog/game-services", () => ({
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
import { claimAndStart, configurePrice, createPaidOrder, deliver, ledgerFor, rankCheckout, rankOffer, seedUser, setConfig, sum } from "../support/payment-fixtures";
import { claimOrder, completeAssignment, abandonOrder } from "@/lib/assignments/service";
import { republishDraftOrder } from "@/lib/orders/draft-admin.service";
import { approveEarning, allocateEarningByAdmin } from "@/lib/finance/earnings";
import { requestRefund } from "@/lib/finance/refunds";
import { requestPayout, approvePayout, recordPayoutPaid, rejectPayout, markPayoutProcessing } from "@/lib/finance/payouts";
import { splitCommission, allocateProRata, cumulativeShare, parseDecimalToMinor, toDecimalString } from "@/lib/money";
import { GET as boosterEarningsRoute } from "@/app/api/booster/earnings/route";
import { POST as refundRoute } from "@/app/api/admin/orders/[orderId]/refunds/route";
import { POST as payoutAdminRoute } from "@/app/api/admin/finance/payouts/[payoutId]/route";
import { GET as summaryRoute } from "@/app/api/admin/finance/summary/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string; role: string };
let customer: { id: string; role: string };

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  await configurePrice(admin.id, 2500, 2500); // 100.00 EUR
  // Earnings tests use the full booster share (claim now at no discount).
  await setConfig("claim_now_discount_bps", 0);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
  h.getSessionUser.mockResolvedValue(admin);
});

async function completedBy(orderId: string, boosterId: string) {
  const { assignment } = await claimAndStart(orderId, boosterId);
  await completeAssignment(assignment.id, boosterId, "BOOSTER");
  return assignment.id;
}
const refundKey = () => uid("refund-key-00000");

describe("commission arithmetic (integer minor units)", () => {
  it("100.00 -> 45.00 platform / 55.00 booster", () => {
    expect(splitCommission(10000, { platformFeeBps: 4500, boosterShareBps: 5500 })).toMatchObject({ platformFeeAmount: 4500, boosterShareAmount: 5500 });
  });
  it("odd amounts: booster gets the floor, the remainder goes to the platform, parts always sum exactly", () => {
    for (const base of [1, 3, 99, 9999, 12345, 999_999_999]) {
      const s = splitCommission(base, { platformFeeBps: 4500, boosterShareBps: 5500 });
      expect(s.platformFeeAmount + s.boosterShareAmount).toBe(base);
      expect(s.boosterShareAmount).toBe(Math.floor((base * 55) / 100));
    }
    expect(splitCommission(9999, { platformFeeBps: 4500, boosterShareBps: 5500 })).toMatchObject({ boosterShareAmount: 5499, platformFeeAmount: 4500 });
  });
  it("rejects floats and policies that do not sum to 100%", () => {
    expect(() => splitCommission(10.5, { platformFeeBps: 4500, boosterShareBps: 5500 })).toThrow();
    expect(() => splitCommission(100, { platformFeeBps: 4500, boosterShareBps: 5000 })).toThrow();
  });
  it("pro-rata allocation and cumulative shares are exact", () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProRata(5500, [5500, 0])).toEqual([5500, 0]);
    expect(allocateProRata(1, [3, 3, 3])).toEqual([1, 0, 0]);
    // Cumulative booster share after each of three 33.33 refunds of 99.99.
    expect([3333, 6666, 9999].map((c) => cumulativeShare(5499, c, 9999))).toEqual([1833, 3666, 5499]);
    // Amount x amount products beyond 2^53 stay exact.
    expect(cumulativeShare(999_999_999, 999_999_998, 999_999_999)).toBe(999_999_998);
  });
  it("decimal parsing/formatting without floats", () => {
    expect(parseDecimalToMinor("49.99", "EUR")).toBe(4999);
    expect(parseDecimalToMinor("1500", "JPY")).toBe(1500);
    expect(() => parseDecimalToMinor("1.999", "EUR")).toThrow();
    expect(toDecimalString(5, "EUR")).toBe("0.05");
  });
});

describe("booster earnings", () => {
  it("single booster: allocated on completion, PENDING until admin approval, then AVAILABLE", async () => {
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    const assignmentId = await completedBy(orderId, booster.id);

    const e = await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } });
    expect(e).toMatchObject({ status: "PENDING", boosterId: booster.id, assignmentId, grossAmount: 5500 });
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(0);
    expect(sum(ledger, (t) => t.account === "BOOSTER_PAYABLE" && t.boosterId === booster.id)).toBe(5500);

    // Booster cannot approve; admin can.
    await expect(approveEarning(booster.id, e.id)).rejects.toMatchObject({ status: 403 });
    const approved = await approveEarning(admin.id, e.id);
    expect(approved.status).toBe("AVAILABLE");
    await expect(approveEarning(admin.id, e.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.financialAuditLog.count({ where: { entityId: e.id, action: "EARNING_APPROVED" } })).toBe(1);
  });

  it("no duplicate earnings: one reservation per order even if completion logic runs twice", async () => {
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await completedBy(orderId, booster.id);
    const { allocateOnCompletion } = await import("@/lib/finance/earnings");
    const again = await prisma.$transaction((tx) => allocateOnCompletion(tx, orderId, "whatever"));
    expect(again.outcome).toBe("no_reservation");
    expect(await prisma.boosterEarning.count({ where: { orderId } })).toBe(1);
    expect(sum(await ledgerFor(orderId), (t) => t.account === "BOOSTER_PAYABLE")).toBe(5500);
  });

  it("multiple boosters: never awarded wholly to the final booster; admin allocates per assignment", async () => {
    const b1 = await seedUser("BOOSTER");
    const b2 = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    const first = await claimAndStart(orderId, b1.id);
    await abandonOrder(first.assignment.id, b1.id, "Cannot continue");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DRAFT");
    // Paid, so republishing is allowed.
    await republishDraftOrder(orderId, admin.id);
    const secondId = await completedBy(orderId, b2.id);

    const reservation = await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } });
    expect(reservation).toMatchObject({ status: "PENDING_REVIEW", boosterId: null });
    expect(sum(await ledgerFor(orderId), (t) => t.account === "BOOSTER_PAYABLE")).toBe(0);

    await expect(
      allocateEarningByAdmin(admin.id, reservation.id, [{ assignmentId: first.assignment.id, amount: 1000 }, { assignmentId: secondId, amount: 1000 }], "Split by progress")
    ).rejects.toMatchObject({ status: 400 }); // must sum to 5500
    await expect(
      allocateEarningByAdmin(admin.id, reservation.id, [{ assignmentId: "not-an-assignment", amount: 5500 }], "x y z")
    ).rejects.toMatchObject({ status: 400 });

    const children = await allocateEarningByAdmin(
      admin.id,
      reservation.id,
      [{ assignmentId: first.assignment.id, amount: 1500 }, { assignmentId: secondId, amount: 4000 }],
      "Booster 1 did Gold IV-III, booster 2 the rest"
    );
    expect(children.map((c) => [c.boosterId, c.grossAmount, c.status])).toEqual([[b1.id, 1500, "PENDING"], [b2.id, 4000, "PENDING"]]);
    expect((await prisma.boosterEarning.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("SPLIT");
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.account === "BOOSTER_PAYABLE" && t.boosterId === b1.id)).toBe(1500);
    expect(sum(ledger, (t) => t.account === "BOOSTER_PAYABLE" && t.boosterId === b2.id)).toBe(4000);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(0);
  });

  it("a booster sees only their own earnings", async () => {
    const mine = await seedUser("BOOSTER");
    const theirs = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await completedBy(orderId, theirs.id);
    h.getSessionUser.mockResolvedValue(mine);
    const body = await (await boosterEarningsRoute()).json();
    expect(body.earnings.map((e: any) => e.orderId)).not.toContain(orderId);
    h.getSessionUser.mockResolvedValue(customer);
    expect((await boosterEarningsRoute()).status).toBe(403);
  });
});

describe("manual payouts", () => {
  async function availableEarningFor(boosterId: string) {
    const { orderId } = await createPaidOrder(customer.id);
    await completedBy(orderId, boosterId);
    const e = await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } });
    await approveEarning(admin.id, e.id);
    return { orderId, earningId: e.id };
  }

  it("request -> approve -> processing -> paid with reference and evidence", async () => {
    const booster = await seedUser("BOOSTER");
    const { earningId } = await availableEarningFor(booster.id);
    const payout = await requestPayout(booster.id, "eur");
    expect(payout).toMatchObject({ amount: 5500, currency: "EUR", status: "REQUESTED" });
    expect((await prisma.boosterEarning.findUniqueOrThrow({ where: { id: earningId } })).status).toBe("IN_PAYOUT");

    // Duplicate request while one is open.
    await expect(requestPayout(booster.id, "EUR")).rejects.toMatchObject({ status: 409 });

    await approvePayout(admin.id, payout.id);
    await markPayoutProcessing(admin.id, payout.id);
    // Paid requires method, reference and evidence.
    await expect(recordPayoutPaid(admin.id, payout.id, { method: "bank", externalReference: "", evidence: "x" })).rejects.toMatchObject({ status: 400 });
    const ref = uid("SEPA-REF");
    const paid = await recordPayoutPaid(admin.id, payout.id, { method: "bank_transfer", externalReference: ref, evidence: "Bank statement 2026-11 line 12" });
    expect(paid.status).toBe("PAID");
    expect((await prisma.boosterEarning.findUniqueOrThrow({ where: { id: earningId } })).status).toBe("PAID");
    const payable = await prisma.financialTransaction.aggregate({ _sum: { amount: true }, where: { account: "BOOSTER_PAYABLE", boosterId: booster.id } });
    expect(payable._sum.amount).toBe(0);
    // Recording it again is impossible.
    await expect(recordPayoutPaid(admin.id, payout.id, { method: "bank_transfer", externalReference: ref, evidence: "again" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.financialTransaction.count({ where: { payoutId: payout.id } })).toBe(2);
    // Nothing left to pay.
    await expect(requestPayout(booster.id, "EUR")).rejects.toMatchObject({ status: 409 });
  });

  it("the same external reference cannot be recorded for two payouts", async () => {
    const b1 = await seedUser("BOOSTER");
    const b2 = await seedUser("BOOSTER");
    await availableEarningFor(b1.id);
    await availableEarningFor(b2.id);
    const p1 = await requestPayout(b1.id, "EUR");
    const p2 = await requestPayout(b2.id, "EUR");
    await approvePayout(admin.id, p1.id);
    await approvePayout(admin.id, p2.id);
    const ref = uid("DUP-REF");
    await recordPayoutPaid(admin.id, p1.id, { method: "paypal", externalReference: ref, evidence: "PayPal receipt" });
    await expect(recordPayoutPaid(admin.id, p2.id, { method: "paypal", externalReference: ref, evidence: "PayPal receipt" })).rejects.toMatchObject({ status: 409 });
    expect((await prisma.boosterPayout.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe("APPROVED");
  });

  it("reject returns the earnings to AVAILABLE and requires a reason", async () => {
    const booster = await seedUser("BOOSTER");
    const { earningId } = await availableEarningFor(booster.id);
    const payout = await requestPayout(booster.id, "EUR");
    await expect(rejectPayout(admin.id, payout.id, "")).rejects.toMatchObject({ status: 400 });
    await rejectPayout(admin.id, payout.id, "Payout details missing");
    expect((await prisma.boosterEarning.findUniqueOrThrow({ where: { id: earningId } })).status).toBe("AVAILABLE");
    // A new request is possible after rejection.
    expect((await requestPayout(booster.id, "EUR")).status).toBe("REQUESTED");
  });

  it("admin-only via the API; 'paid' without evidence is rejected by validation", async () => {
    const booster = await seedUser("BOOSTER");
    await availableEarningFor(booster.id);
    const payout = await requestPayout(booster.id, "EUR");
    const call = (body: unknown) =>
      payoutAdminRoute(new Request("http://t", { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest, { params: Promise.resolve({ payoutId: payout.id }) });
    h.getSessionUser.mockResolvedValue(booster);
    expect((await call({ action: "approve" })).status).toBe(403);
    h.getSessionUser.mockResolvedValue(admin);
    expect((await call({ action: "approve" })).status).toBe(200);
    expect((await call({ action: "paid", method: "bank", externalReference: "R1" })).status).toBe(400);
  });
});

describe("refunds", () => {
  it("partial then full refund reverse exactly 45/55 and cancel the unclaimed order", async () => {
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    const r1 =await requestRefund(admin.id, { orderId, amount: 3000, reason: "Partial: delay", idempotencyKey: refundKey() });
    expect(r1).toMatchObject({ status: "SUCCEEDED", platformReversalAmount: 1350, boosterReversalAmount: 1650 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");

    const r2 = await requestRefund(admin.id, { orderId, amount: 7000, reason: "Customer request", idempotencyKey: refundKey() });
    expect(r2.status).toBe("SUCCEEDED");
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.account === "CUSTOMER_PAYMENTS")).toBe(0);
    expect(sum(ledger, (t) => t.account === "PLATFORM_REVENUE")).toBe(0);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).amountRefunded).toBe(10000);
    // History kept: original payment and earning rows still exist.
    expect(await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } })).toMatchObject({ status: "REVERSED", reversedAmount: 5500 });
    // Over-refund is rejected.
    await expect(requestRefund(admin.id, { orderId, amount: 1, reason: "more", idempotencyKey: refundKey() })).rejects.toMatchObject({ status: 400 });
  });

  it("odd-amount partial refunds add up to the exact original split", async () => {
    await configurePrice(admin.id, 2499, 2500); // 99.99 EUR -> booster 54.99, platform 45.00
    try {
      const { orderId } = await createPaidOrder(customer.id);
      for (const amount of [3333, 3333, 3333]) {
        await requestRefund(admin.id, { orderId, amount, reason: "Three equal refunds", idempotencyKey: refundKey() });
      }
      const refunds = await prisma.refund.findMany({ where: { orderId } });
      expect(refunds.reduce((a, r) => a + (r.boosterReversalAmount ?? 0), 0)).toBe(5499);
      expect(refunds.reduce((a, r) => a + (r.platformReversalAmount ?? 0), 0)).toBe(4500);
      const ledger = await ledgerFor(orderId);
      expect(sum(ledger, (t) => t.account === "PLATFORM_REVENUE")).toBe(0);
      expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(0);
    } finally {
      await configurePrice(admin.id, 2500, 2500);
    }
  });

  it("a refund after payout makes the booster balance negative (no history rewritten)", async () => {
    const booster = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await completedBy(orderId, booster.id);
    const e = await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } });
    await approveEarning(admin.id, e.id);
    const payout = await requestPayout(booster.id, "EUR");
    await approvePayout(admin.id, payout.id);
    await recordPayoutPaid(admin.id, payout.id, { method: "bank", externalReference: uid("R"), evidence: "statement" });

    await requestRefund(admin.id, { orderId, amount: 2000, reason: "Goodwill", idempotencyKey: refundKey() });
    const payable = await prisma.financialTransaction.aggregate({ _sum: { amount: true }, where: { account: "BOOSTER_PAYABLE", boosterId: booster.id } });
    expect(payable._sum.amount).toBe(-1100); // 55% of 20.00
    const after = await prisma.boosterEarning.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ status: "PAID", grossAmount: 5500, reversedAmount: 1100 });
  });

  it("a failed Stripe refund is recorded and posts nothing", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    h.stripe.state.failNextRefund = true;
    await expect(requestRefund(admin.id, { orderId, amount: 1000, reason: "test", idempotencyKey: refundKey() })).rejects.toMatchObject({ status: 502 });
    const r = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    expect(r.status).toBe("FAILED");
    expect(await prisma.financialTransaction.count({ where: { refundId: r.id } })).toBe(0);
  });

  it("a pending refund is finalised exactly once by webhooks", async () => {
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    h.stripe.state.refundStatus = "pending";
    const r = await requestRefund(admin.id, { orderId, amount: 1000, reason: "pending one", idempotencyKey: refundKey() });
    expect(r.status).toBe("PENDING");
    const pi = (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).stripePaymentIntentId;
    const refundObj = { id: r.stripeRefundId, object: "refund", amount: 1000, currency: "eur", status: "succeeded", payment_intent: pi, metadata: { refundId: r.id } };
    await deliver(stripeEvent("refund.updated", refundObj));
    await deliver(stripeEvent("charge.refunded", { id: "ch_1", object: "charge", payment_intent: pi, refunds: { data: [refundObj], has_more: false } }));
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("SUCCEEDED");
    expect(await prisma.financialTransaction.count({ where: { refundId: r.id, account: "CUSTOMER_PAYMENTS" } })).toBe(1);
  });

  it("a refund created in the Stripe Dashboard is reconciled from the webhook", async () => {
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    const pi = (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).stripePaymentIntentId;
    await deliver(stripeEvent("refund.created", { id: `re_dash_${paymentId}`, object: "refund", amount: 500, currency: "eur", status: "succeeded", payment_intent: pi, metadata: {} }));
    const r = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    expect(r).toMatchObject({ source: "STRIPE", status: "SUCCEEDED", amount: 500 });
  });

  it("the refund API is admin-only and needs a reason and an Idempotency-Key", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const call = (body: unknown, key?: string) =>
      refundRoute(
        new Request("http://t", { method: "POST", headers: key ? { "Idempotency-Key": key } : {}, body: JSON.stringify(body) }) as unknown as NextRequest,
        { params: Promise.resolve({ orderId }) }
      );
    h.getSessionUser.mockResolvedValue(customer);
    expect((await call({ amount: 100, reason: "abc" }, refundKey())).status).toBe(403);
    h.getSessionUser.mockResolvedValue(admin);
    expect((await call({ amount: 100 }, refundKey())).status).toBe(400);
    expect((await call({ amount: 100, reason: "abc" })).status).toBe(400);
    const key = refundKey();
    const a = await (await call({ amount: 100, reason: "abc" }, key)).json();
    const b = await (await call({ amount: 100, reason: "abc" }, key)).json();
    expect(b.refund.id).toBe(a.refund.id);
    expect(h.stripe.state.refundCreateCalls).toHaveLength(1);
  });
});

describe("disputes", () => {
  it("an open dispute holds earnings and blocks release; a lost dispute reverses once", async () => {
    const booster = await seedUser("BOOSTER");
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    await completedBy(orderId, booster.id);
    const pi = (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).stripePaymentIntentId;
    const dispute = { id: `dp_${paymentId}`, object: "dispute", amount: 10000, currency: "eur", reason: "fraudulent", status: "needs_response", payment_intent: pi };
    await deliver(stripeEvent("charge.dispute.created", dispute));
    const e = await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } });
    expect(e.status).toBe("ON_HOLD");
    await expect(approveEarning(admin.id, e.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: { startsWith: "dispute-opened:" } } })).toBeGreaterThan(0);

    const closed = stripeEvent("charge.dispute.closed", { ...dispute, status: "lost" });
    await deliver(closed);
    await deliver(stripeEvent("charge.dispute.closed", { ...dispute, status: "lost" })); // a second, different event
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.type === "DISPUTE_LOSS")).toBe(-10000);
    expect(sum(ledger, (t) => t.account === "BOOSTER_PAYABLE")).toBe(0);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { stripeDisputeId: dispute.id } })).status).toBe("LOST");
  });

  it("a won dispute releases the hold back to PENDING (re-approval)", async () => {
    const booster = await seedUser("BOOSTER");
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    await completedBy(orderId, booster.id);
    const pi = (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).stripePaymentIntentId;
    const d = { id: `dp_won_${paymentId}`, object: "dispute", amount: 10000, currency: "eur", reason: "product_not_received", status: "needs_response", payment_intent: pi };
    await deliver(stripeEvent("charge.dispute.created", d));
    await deliver(stripeEvent("charge.dispute.closed", { ...d, status: "won" }));
    expect((await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } })).status).toBe("PENDING");
  });
});

describe("admin finance summary", () => {
  it("reports figures derived from the ledger, admin-only", async () => {
    h.getSessionUser.mockResolvedValue(customer);
    expect((await summaryRoute()).status).toBe(403);
    h.getSessionUser.mockResolvedValue(admin);
    const body = await (await summaryRoute()).json();
    expect(body.summary.customerPayments.EUR).toBeGreaterThan(0);
    expect(body.summary.platformCommission.EUR).toBeGreaterThan(0);
    expect(body.releasePolicy.mode).toBe("MANUAL_ADMIN_APPROVAL");
  });
});
