// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 6 against an in-memory PostgreSQL (all migrations): release within
 * the free window vs late release (strike, DRAFT), bid margin restored when
 * a booster leaves, admin fines in the ledger and taken off payouts,
 * appeals and reversals, strikes for missed starts, inactivity warnings.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
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

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { claimAndStart, configurePrice, createPaidOrder, ledgerFor, rankCheckout, rankOffer, seedUser, setConfig, sum } from "../support/payment-fixtures";
import { abandonOrder, claimOrder, completeAssignment } from "@/lib/assignments/service";
import { getPoolForBooster } from "@/lib/pool/service";
import { appealFine, decideFineAppeal, issueFine, reverseFine, strikeSummary } from "@/lib/boosters/discipline";
import { approveEarning } from "@/lib/finance/earnings";
import { recordPayoutPaid, approvePayout, rejectPayout, requestPayout } from "@/lib/finance/payouts";
import { runInactivityWarnings, runSlaWarnings } from "@/lib/pool/sla";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string };
const SHARE = 5500; // booster share of the 100.00 EUR fixture order

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  await configurePrice(admin.id, 2500, 2500);
  await setConfig("claim_now_discount_bps", 2500);
  await setConfig("release_grace_min", 10);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

/** A booster with one completed order and an AVAILABLE earning of `SHARE`. */
async function boosterWithAvailableEarning() {
  await setConfig("claim_now_discount_bps", 0);
  const b = await seedUser("BOOSTER");
  const { orderId } = await createPaidOrder(customer.id);
  const { assignment } = await claimAndStart(orderId, b.id);
  await completeAssignment(assignment.id, b.id, "BOOSTER");
  const e = await prisma.boosterEarning.findFirstOrThrow({ where: { boosterId: b.id, orderId } });
  await approveEarning(admin.id, e.id);
  await setConfig("claim_now_discount_bps", 2500);
  return { booster: b, orderId };
}

describe("release", () => {
  it("within the free window: back to the pool, no strike, margin and trial order given back", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    await prisma.boosterProfile.update({ where: { userId: b.id }, data: { verificationStatus: "TRIAL", trialOrdersRemaining: 2 } });
    const { assignment } = await claimOrder(orderId, b.id); // claim now: 75 % payout, margin to the platform
    expect((await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: b.id } })).trialOrdersRemaining).toBe(1);

    const r = await abandonOrder(assignment.id, b.id, "changed my mind");
    expect(r.inGrace).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: "PENDING", boosterPayoutAmount: null });
    expect((await strikeSummary(b.id)).total).toBe(0);
    expect((await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: b.id } })).trialOrdersRemaining).toBe(2);
    // The platform margin is back in the booster share: the next booster sees the full payout.
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.type === "BOOSTER_BID_MARGIN" && t.account === "PLATFORM_REVENUE")).toBe(0);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(SHARE);
    const other = await seedUser("BOOSTER");
    expect((await getPoolForBooster(other.id)).orders.find((o) => o.id === orderId)?.payoutCeiling).toBe(SHARE);
    // The booster who left never sees it again.
    expect((await getPoolForBooster(b.id)).orders.map((o) => o.id)).not.toContain(orderId);
  });

  it("after starting: DRAFT for review and a strike; the booster is told", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimAndStart(orderId, b.id);
    const r = await abandonOrder(assignment.id, b.id, "no time anymore");
    expect(r.inGrace).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DRAFT");
    const s = await strikeSummary(b.id);
    expect(s.strikes.map((x) => x.code)).toEqual(["LATE_RELEASE"]);
    expect(await prisma.notification.count({ where: { userId: b.id, type: "STRIKE_ADDED" } })).toBe(1);
  });

  it("not started but past the free window: also a strike", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimOrder(orderId, b.id);
    await prisma.orderBoosterAssignment.update({ where: { id: assignment.id }, data: { assignedAt: new Date(Date.now() - 30 * 60_000) } });
    const r = await abandonOrder(assignment.id, b.id, "too late now");
    expect(r.inGrace).toBe(false);
    expect((await strikeSummary(b.id)).total).toBe(1);
  });
});

describe("fines", () => {
  it("only admins fine, only for an order the booster worked on; ledger and strike follow", async () => {
    const { booster, orderId } = await boosterWithAvailableEarning();
    await expect(issueFine(booster.id, { boosterId: booster.id, orderId, code: "CONTACT_LEAK", note: "shared discord" })).rejects.toMatchObject({ status: 403 });
    const otherOrder = await createPaidOrder(customer.id);
    await expect(issueFine(admin.id, { boosterId: booster.id, orderId: otherOrder.orderId, code: "CONTACT_LEAK", note: "shared discord" })).rejects.toMatchObject({ status: 400 });
    await expect(issueFine(admin.id, { boosterId: booster.id, orderId, code: "NOPE", note: "shared discord" })).rejects.toMatchObject({ status: 400 });

    const fine = await issueFine(admin.id, { boosterId: booster.id, orderId, code: "CONTACT_LEAK", note: "Shared a Discord tag in chat" });
    expect(fine).toMatchObject({ amount: 1000, currency: "EUR", status: "ISSUED" });
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.type === "BOOSTER_FINE" && t.account === "BOOSTER_PAYABLE")).toBe(-1000);
    expect(sum(ledger, (t) => t.type === "BOOSTER_FINE" && t.account === "PLATFORM_REVENUE")).toBe(1000);
    expect((await strikeSummary(booster.id)).strikes[0]).toMatchObject({ code: "FINE", fineId: fine.id });
    expect(await prisma.notification.count({ where: { userId: booster.id, type: "FINE_ISSUED" } })).toBe(1);
  });

  it("an unpaid fine is taken off the next payout; a rejected payout makes it due again", async () => {
    const { booster, orderId } = await boosterWithAvailableEarning();
    const fine = await issueFine(admin.id, { boosterId: booster.id, orderId, code: "OTHER", amount: 750, note: "Ignored the role request" });
    const payout = await requestPayout(booster.id, "EUR");
    expect(payout).toMatchObject({ amount: SHARE - 750, finesDeducted: 750 });
    expect((await prisma.boosterFine.findUniqueOrThrow({ where: { id: fine.id } })).deductedPayoutId).toBe(payout.id);

    await rejectPayout(admin.id, payout.id, "wrong details");
    expect((await prisma.boosterFine.findUniqueOrThrow({ where: { id: fine.id } })).deductedPayoutId).toBeNull();
    const again = await requestPayout(booster.id, "EUR");
    expect(again.amount).toBe(SHARE - 750);
    await approvePayout(admin.id, again.id);
    await recordPayoutPaid(admin.id, again.id, { method: "bank", externalReference: `ref-${again.id}`, evidence: "receipt" });
    // Earnings paid in full; the fine and the net payout leave the booster payable at zero.
    expect(sum(await prisma.financialTransaction.findMany({ where: { boosterId: booster.id, account: "BOOSTER_PAYABLE" } }), () => true)).toBe(0);
  });

  it("appeals: rejected = upheld; accepted after payment = refund as an available earning, strike removed", async () => {
    const { booster, orderId } = await boosterWithAvailableEarning();
    const f1 = await issueFine(admin.id, { boosterId: booster.id, orderId, code: "CUSTOMER_REQUESTS", note: "Played a champion that was not asked" });
    await expect(appealFine(booster.id, f1.id, "short")).rejects.toMatchObject({ status: 400 });
    await appealFine(booster.id, f1.id, "The customer asked for it in chat, see the messages");
    await expect(appealFine(booster.id, f1.id, "again and again and again")).rejects.toMatchObject({ status: 409 });
    // An appealed fine is not taken off a payout until decided.
    const p = await requestPayout(booster.id, "EUR");
    expect(p.finesDeducted).toBe(0);
    await rejectPayout(admin.id, p.id, "wait for the appeal");
    await decideFineAppeal(admin.id, f1.id, false, "The chat shows no such request");
    expect((await prisma.boosterFine.findUniqueOrThrow({ where: { id: f1.id } })).status).toBe("UPHELD");

    const paid = await requestPayout(booster.id, "EUR");
    expect(paid.finesDeducted).toBe(500);
    await approvePayout(admin.id, paid.id);
    await recordPayoutPaid(admin.id, paid.id, { method: "bank", externalReference: `ref-${paid.id}`, evidence: "receipt" });

    await reverseFine(admin.id, f1.id, "Customer confirmed the request later");
    const fine = await prisma.boosterFine.findUniqueOrThrow({ where: { id: f1.id } });
    expect(fine.status).toBe("REVERSED");
    const refund = await prisma.boosterEarning.findFirstOrThrow({ where: { boosterId: booster.id, status: "AVAILABLE" } });
    expect(refund.grossAmount).toBe(500);
    expect((await strikeSummary(booster.id)).total).toBe(0);
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.type === "BOOSTER_FINE_REVERSAL" && t.account === "BOOSTER_PAYABLE")).toBe(500);
  });
});

describe("strikes and inactivity (warnings only)", () => {
  it("a missed start is a strike; the order stays with the booster", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimOrder(orderId, b.id);
    await prisma.orderBoosterAssignment.update({ where: { id: assignment.id }, data: { assignedAt: new Date(Date.now() - 2 * 3_600_000) } });
    await runSlaWarnings();
    expect((await strikeSummary(b.id)).strikes.map((s) => s.code)).toContain("SLA_START");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CLAIMED");
  });

  it("12 hours without games or messages warns the booster and admins once", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimAndStart(orderId, b.id);
    await prisma.orderBoosterAssignment.update({ where: { id: assignment.id }, data: { startedAt: new Date(Date.now() - 13 * 3_600_000) } });
    await runInactivityWarnings();
    await runInactivityWarnings();
    expect(await prisma.notification.count({ where: { userId: b.id, type: "INACTIVITY_WARNING", orderId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "INACTIVITY_WARNING", orderId } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("IN_PROGRESS");
  });

  it("recent activity means no warning", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimAndStart(orderId, b.id);
    await prisma.orderBoosterAssignment.update({ where: { id: assignment.id }, data: { startedAt: new Date(Date.now() - 13 * 3_600_000) } });
    const conv = await prisma.orderConversation.create({ data: { orderId } });
    await prisma.orderMessage.create({ data: { conversationId: conv.id, senderId: b.id, content: "on it" } });
    await runInactivityWarnings();
    expect(await prisma.notification.count({ where: { userId: b.id, type: "INACTIVITY_WARNING", orderId } })).toBe(0);
  });
});
