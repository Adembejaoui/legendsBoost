// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 3 against an in-memory PostgreSQL (all migrations): the pool filtered
 * by rank ceiling / region / service, payout shown instead of the customer
 * price, claim now (-25 %), sealed bids (lowest wins, ties earliest),
 * priority and preferred-booster claims, the active-order limit, CLAIMED ->
 * start, the bid margin in the ledger, new rounds on re-entry and SLA
 * warnings.
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
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/realtime/live", () => ({ signalPool: vi.fn(async () => {}), signalUsers: vi.fn(async () => {}), signalOrder: vi.fn(async () => {}) }));
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
import {
  claimAndStart,
  configurePrice,
  createPaidOrder,
  deliver,
  ledgerFor,
  rankCheckout,
  rankOffer,
  seedUser,
  sessionFor,
  setConfig,
  startCheckout,
  sum,
} from "../support/payment-fixtures";
import { eligibilityProblem, orderRankRequirement, payoutAmounts } from "@/lib/pool/eligibility";
import { claimNow, closeDueBidding, getPoolForBooster, placeBid, withdrawBid } from "@/lib/pool/service";
import { getOrderWorkspace } from "@/lib/orders/workspace-data";
import { runSlaWarnings } from "@/lib/pool/sla";
import { claimOrder, completeAssignment, releaseAssignment, startAssignment } from "@/lib/assignments/service";
import { createOrderForCustomer } from "@/lib/orders/order-creation.service";
import { listPreferableBoosters } from "@/lib/pool/preferred";
import { OrderNotClaimableError, OrderNotFoundError } from "@/lib/assignments/types";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string; role: string };

// Gold IV -> Gold I: 25.00 + 3 x 25.00 = 100.00 EUR; booster share 55.00.
const SHARE = 5500;

/** A booster limited to League of Legends up to the given rank. */
async function boosterWithCeiling(tierId: string, divisionId: string | null, extra: { regions?: string[]; serviceSlugs?: string[] } = {}) {
  const b = await seedUser("BOOSTER");
  const { rankValue } = await import("@/lib/domain/rank");
  await prisma.boosterPermission.updateMany({
    where: { boosterProfile: { userId: b.id }, gameSlug: "league-of-legends" },
    data: {
      maxTargetRankValue: rankValue("lol-ranked", { tierId, divisionId })!,
      maxTargetTierId: tierId,
      maxTargetDivisionId: divisionId,
      regions: extra.regions ?? [],
      serviceSlugs: extra.serviceSlugs ?? [],
    },
  });
  return b;
}

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
  await setConfig("bid_window_sec", 60);
  await setConfig("min_bid_bps", 5000);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

describe("eligibility rules", () => {
  const order = { gameSlug: "league-of-legends", serviceSlug: "rank-boost", configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "i" } } };
  const perm = (value: number, extra: Partial<{ regions: string[]; serviceSlugs: string[] }> = {}) => [
    { gameSlug: "league-of-legends", rankSystemId: "lol-ranked", maxTargetRankValue: value, regions: [], serviceSlugs: [], ...extra },
  ];

  it("a rank boost needs its target rank", () => {
    expect(orderRankRequirement(order)).toEqual({ rankSystemId: "lol-ranked", value: 15 }); // Gold I
  });

  it("game, service, region and rank ceiling are all enforced", () => {
    expect(eligibilityProblem([], order)).toBe("NO_GAME_PERMISSION");
    expect(eligibilityProblem(perm(14), order)).toBe("ABOVE_RANK_CEILING");
    expect(eligibilityProblem(perm(15), order)).toBeNull();
    expect(eligibilityProblem(perm(28, { serviceSlugs: ["win-boost"] }), order)).toBe("SERVICE_NOT_ALLOWED");
    expect(eligibilityProblem(perm(28, { regions: ["NA1"] }), { ...order, region: "euw1" })).toBe("REGION_NOT_ALLOWED");
    expect(eligibilityProblem(perm(28, { regions: ["EUW1"] }), { ...order, region: "euw1" })).toBeNull();
  });

  it("claim now is the ceiling minus 25 %; the minimum bid is half the ceiling", () => {
    expect(payoutAmounts(SHARE, { claimNowDiscountBps: 2500, minBidBps: 5000 })).toEqual({ ceiling: SHARE, claimNow: 4125, minBid: 2750 });
  });
});

describe("pool", () => {
  it("shows only orders within the booster's ceiling, with the payout and never the customer price", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const silver = await boosterWithCeiling("silver", "i");
    const gold = await boosterWithCeiling("gold", "i");

    expect((await getPoolForBooster(silver.id)).orders.map((o) => o.id)).not.toContain(orderId);
    const pool = await getPoolForBooster(gold.id);
    const card = pool.orders.find((o) => o.id === orderId)!;
    expect(card).toMatchObject({ payoutCeiling: SHARE, claimNowAmount: 4125, minBid: 2750, currency: "EUR", bidCount: 0, myBid: null });
    expect(card).not.toHaveProperty("price");
    expect(card).not.toHaveProperty("user");
    expect(JSON.stringify(card)).not.toContain("10000");

    // Taking it is refused the same way (no deep-link bypass).
    await expect(claimNow(silver.id, orderId)).rejects.toMatchObject({ status: 403, code: "ABOVE_RANK_CEILING" });
  });

  it("claim now: CLAIMED at 75 % of the payout, the difference goes to the platform, then start and complete", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimOrder(orderId, b.id);
    expect(assignment).toMatchObject({ status: "ASSIGNED", awardMode: "CLAIM_NOW", payoutAmount: 4125 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: "CLAIMED", boosterPayoutAmount: 4125 });
    expect(order.claimedAt).toBeInstanceOf(Date);
    expect((await prisma.orderEvent.findMany({ where: { orderId } })).map((e) => e.type)).toContain("ORDER_CLAIMED");

    let ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.type === "BOOSTER_BID_MARGIN" && t.account === "PLATFORM_REVENUE")).toBe(SHARE - 4125);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(4125);
    expect((await prisma.boosterEarning.findUniqueOrThrow({ where: { reservationKey: orderId } })).grossAmount).toBe(4125);

    // Not started: cannot complete yet.
    await expect(completeAssignment(assignment.id, b.id, "BOOSTER")).rejects.toThrow();
    await startAssignment(orderId, b.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("IN_PROGRESS");
    expect((await startAssignment(orderId, b.id)).changed).toBe(false); // double click
    await completeAssignment(assignment.id, b.id, "BOOSTER");
    ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.account === "BOOSTER_PAYABLE" && t.boosterId === b.id)).toBe(4125);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(0);
  });

  it("missing, paused and completed orders cannot be taken", async () => {
    const b = await seedUser("BOOSTER");
    await expect(claimOrder("no-such-order", b.id)).rejects.toBeInstanceOf(OrderNotFoundError);
    const { orderId } = await createPaidOrder(customer.id);
    const first = await seedUser("BOOSTER");
    await claimAndStart(orderId, first.id);
    await expect(claimOrder(orderId, b.id)).rejects.toBeInstanceOf(OrderNotClaimableError);
  });

  it("a booster holds at most their limit of active orders; an admin can raise it", async () => {
    const b = await seedUser("BOOSTER");
    const one = await createPaidOrder(customer.id);
    const two = await createPaidOrder(customer.id);
    await claimOrder(one.orderId, b.id);
    await expect(claimOrder(two.orderId, b.id)).rejects.toMatchObject({ status: 409, code: "LIMIT_REACHED" });
    expect((await getPoolForBooster(b.id)).blockedReason).toMatch(/Finish your current order/);
    await prisma.boosterProfile.update({ where: { userId: b.id }, data: { maxConcurrentOrders: 2 } });
    await claimOrder(two.orderId, b.id);
  });
});

describe("live pool signals", () => {
  it("payment, claim and bids tell boosters the pool changed (no order data)", async () => {
    const { signalPool } = await import("@/lib/realtime/live");
    const sp = vi.mocked(signalPool);
    sp.mockClear();
    const { orderId } = await createPaidOrder(customer.id);
    expect(sp).toHaveBeenCalledWith("added");
    const b1 = await seedUser("BOOSTER");
    await placeBid(b1.id, orderId, 4000);
    expect(sp).toHaveBeenCalledWith("bid");
    const b2 = await seedUser("BOOSTER");
    sp.mockClear();
    await claimNow(b2.id, orderId);
    expect(sp).toHaveBeenCalledWith("removed");
  });
});

describe("sealed bidding", () => {
  it("the first bid opens a window; bids are visible and must go lower; never above the payout; lowest wins", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const [b1, b2, b3] = [await seedUser("BOOSTER"), await seedUser("BOOSTER"), await seedUser("BOOSTER")];

    await expect(placeBid(b1.id, orderId, 100)).rejects.toMatchObject({ status: 422, code: "AMOUNT_OUT_OF_RANGE" });
    await expect(placeBid(b1.id, orderId, SHARE + 1)).rejects.toMatchObject({ status: 422 });

    const first = await placeBid(b1.id, orderId, 4000);
    expect(first.closesAt).toBeInstanceOf(Date);
    await placeBid(b2.id, orderId, 3500);
    // Visible bids: the same or a higher amount than the lowest is refused.
    await expect(placeBid(b3.id, orderId, 3500)).rejects.toMatchObject({ status: 422, code: "BID_NOT_LOWER" });
    await expect(placeBid(b3.id, orderId, 3900)).rejects.toMatchObject({ code: "BID_NOT_LOWER" });
    await placeBid(b3.id, orderId, 3400);
    // b2 can only go lower than the new lowest.
    await expect(placeBid(b2.id, orderId, 3450)).rejects.toMatchObject({ code: "BID_NOT_LOWER" });
    await placeBid(b2.id, orderId, 3300);

    const seen = (await getPoolForBooster(b1.id)).orders.find((o) => o.id === orderId)!;
    expect(seen).toMatchObject({ bidCount: 3, myBid: 4000, lowestBid: 3300, payoutCeiling: SHARE });

    // Not due yet: nothing happens.
    expect((await closeDueBidding(orderId)).awarded).toBe(0);
    const later = new Date(first.closesAt!.getTime() + 1000);
    expect(await closeDueBidding(orderId, later)).toMatchObject({ awarded: 1 });

    const won = await prisma.orderBoosterAssignment.findFirstOrThrow({ where: { orderId } });
    expect(won).toMatchObject({ boosterId: b2.id, awardMode: "BID", payoutAmount: 3300, status: "ASSIGNED" });
    const bids = await prisma.orderBid.findMany({ where: { orderId } });
    expect(Object.fromEntries(bids.map((b) => [b.boosterId, b.status]))).toEqual({ [b1.id]: "LOST", [b2.id]: "WON", [b3.id]: "LOST" });
    expect(sum(await ledgerFor(orderId), (t) => t.type === "BOOSTER_BID_MARGIN" && t.account === "PLATFORM_REVENUE")).toBe(SHARE - 3300);

    // The winner's order page shows their payout, never the customer price.
    const ws = await getOrderWorkspace(orderId, { id: b2.id, role: "BOOSTER" } as any);
    expect(ws!.order.price).toBeNull();
    expect(ws!.order.boosterPayout).toEqual({ amount: 3300, currency: "EUR" });
    const forCustomer = await getOrderWorkspace(orderId, { id: customer.id, role: "CUSTOMER" } as any);
    expect(Number(forCustomer!.order.price)).toBe(100);
    expect(forCustomer!.order.boosterPayout).toBeNull();
    const notes = await prisma.notification.findMany({ where: { orderId, type: { in: ["BID_WON", "BID_LOST"] } } });
    expect(notes.filter((n) => n.type === "BID_WON").map((n) => n.userId)).toEqual([b2.id]);
    expect(notes.filter((n) => n.type === "BID_LOST").map((n) => n.userId).sort()).toEqual([b1.id, b3.id].sort());
  });

  it("a bid can be changed and withdrawn while open; a winner who cannot take it is skipped", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const busy = await seedUser("BOOSTER");
    const free = await seedUser("BOOSTER");
    const r = await placeBid(free.id, orderId, 4500);
    await withdrawBid(free.id, orderId);
    await placeBid(free.id, orderId, 4400);
    await placeBid(busy.id, orderId, 3000);
    await placeBid(busy.id, orderId, 2900); // a booster may lower their own lowest bid
    expect((await prisma.orderBid.findFirstOrThrow({ where: { orderId, boosterId: busy.id } })).editCount).toBe(1);

    // The lowest bidder takes another order meanwhile (limit 1).
    const other = await createPaidOrder(customer.id);
    await claimOrder(other.orderId, busy.id);

    await closeDueBidding(orderId, new Date(r.closesAt!.getTime() + 1000));
    const won = await prisma.orderBoosterAssignment.findFirstOrThrow({ where: { orderId } });
    expect(won).toMatchObject({ boosterId: free.id, payoutAmount: 4400 });
  });

  it("no eligible bid: the round stays open; claim now ends bidding at once", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const bidder = await seedUser("BOOSTER");
    const r = await placeBid(bidder.id, orderId, 3000);
    await withdrawBid(bidder.id, orderId);
    expect(await closeDueBidding(orderId, new Date(r.closesAt!.getTime() + 1000))).toMatchObject({ reopened: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).biddingClosesAt).toBeNull();

    await placeBid(bidder.id, orderId, 3000);
    const taker = await seedUser("BOOSTER");
    await claimNow(taker.id, orderId);
    expect((await prisma.orderBid.findFirstOrThrow({ where: { orderId, boosterId: bidder.id } })).status).toBe("LOST");
  });

  it("an order back in the pool starts a new round, and the previous booster no longer sees it", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimOrder(orderId, b.id);
    const before = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).biddingRound;
    await releaseAssignment(assignment.id, admin.id, "ADMIN", "Booster unavailable");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.status).toBe("PENDING");
    expect(after.biddingRound).toBe(before + 1);
    expect((await getPoolForBooster(b.id)).orders.map((o) => o.id)).not.toContain(orderId);
    await expect(claimNow(b.id, orderId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("priority and preferred booster", () => {
  it("a priority order is not auctioned and is claimed at the full payout", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    await prisma.order.update({ where: { id: orderId }, data: { isPriority: true } });
    const b = await seedUser("BOOSTER");
    await expect(placeBid(b.id, orderId, 3000)).rejects.toMatchObject({ status: 409, code: "PRIORITY_ORDER" });
    const { assignment } = await claimOrder(orderId, b.id);
    expect(assignment).toMatchObject({ awardMode: "PRIORITY", payoutAmount: SHARE });
    expect(sum(await ledgerFor(orderId), (t) => t.type === "BOOSTER_BID_MARGIN")).toBe(0);
  });

  it("a chosen booster gets the order alone for the window, at the full payout", async () => {
    const chosen = await seedUser("BOOSTER");
    const other = await seedUser("BOOSTER");
    await prisma.boosterProfile.update({ where: { userId: chosen.id }, data: { displayName: uid("Pick").slice(0, 20).replace(/[^A-Za-z0-9_.-]/g, "") } });
    const request = {
      gameSlug: "league-of-legends",
      serviceSlug: "rank-boost",
      configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "i" } },
      selectedOptions: [],
      riskAccepted: true as const,
    };
    expect((await listPreferableBoosters(request)).map((b) => b.id)).toContain(chosen.id);
    // A booster without a public name cannot be chosen.
    await expect(createOrderForCustomer(customer.id, { ...request, preferredBoosterId: other.id } as any, uid("idem-pref-no"))).rejects.toMatchObject({ status: 409 });

    const { order } = await createOrderForCustomer(customer.id, { ...request, preferredBoosterId: chosen.id } as any, uid("idem-pref"));
    const { paymentId } = await startCheckout(customer.id, order.id);
    expect((await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId)))).status).toBe(200);
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.preferredBoosterId).toBe(chosen.id);
    expect(paid.preferredUntil!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

    expect((await getPoolForBooster(other.id)).orders.map((o) => o.id)).not.toContain(order.id);
    await expect(claimNow(other.id, order.id)).rejects.toMatchObject({ status: 404 });
    const mine = (await getPoolForBooster(chosen.id)).orders.find((o) => o.id === order.id)!;
    expect(mine.preferredForMe).toBe(true);
    await expect(placeBid(chosen.id, order.id, 3000)).rejects.toMatchObject({ code: "PREFERRED_ORDER" });

    // Window over: everyone sees it.
    await prisma.order.update({ where: { id: order.id }, data: { preferredUntil: new Date(Date.now() - 1000) } });
    expect((await getPoolForBooster(other.id)).orders.map((o) => o.id)).toContain(order.id);
    await prisma.order.update({ where: { id: order.id }, data: { preferredUntil: new Date(Date.now() + 60_000) } });
    const { assignment } = await claimOrder(order.id, chosen.id);
    expect(assignment).toMatchObject({ awardMode: "PREFERRED", payoutAmount: SHARE });
  });
});

describe("SLA warnings (no automatic release)", () => {
  it("contact and start warnings are sent once; the order stays with the booster", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimOrder(orderId, b.id);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    await prisma.orderBoosterAssignment.update({ where: { id: assignment.id }, data: { assignedAt: twoHoursAgo } });

    const first = await runSlaWarnings();
    expect(first.contactWarnings).toBeGreaterThanOrEqual(1);
    expect(first.startWarnings).toBeGreaterThanOrEqual(1);
    const again = await runSlaWarnings();
    expect(again).toEqual({ contactWarnings: 0, startWarnings: 0 });

    const notes = await prisma.notification.findMany({ where: { orderId, type: "SLA_WARNING" } });
    expect(notes.filter((n) => n.userId === b.id)).toHaveLength(2);
    expect(notes.some((n) => n.userId === admin.id)).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CLAIMED");
    expect((await prisma.orderEvent.findMany({ where: { orderId, type: "SLA_START_MISSED" } }))).toHaveLength(1);
  });
});

describe("refund after a bid margin", () => {
  it("a full refund before work returns the agreed payout from the pool and the rest from the platform", async () => {
    const { orderId, paymentId } = await createPaidOrder(customer.id);
    const b = await seedUser("BOOSTER");
    await claimOrder(orderId, b.id); // 4125 to the booster pool, 1375 margin to the platform
    const { postReversal } = await import("@/lib/finance/refunds");
    await prisma.$transaction((tx) => postReversal(tx, { kind: "REFUND", paymentId, amount: 10_000, keyPrefix: `test-refund:${orderId}` }));
    const ledger = await ledgerFor(orderId);
    expect(sum(ledger, (t) => t.account === "BOOSTER_POOL")).toBe(0);
    expect(sum(ledger, (t) => t.account === "PLATFORM_REVENUE")).toBe(0);
    expect(sum(ledger, (t) => t.account === "CUSTOMER_PAYMENTS")).toBe(0);
  });
});
