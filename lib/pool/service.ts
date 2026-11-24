// Server-only module.
/**
 * Order pool, sealed bidding and taking an order [registry F9, F12].
 *
 * Decisions (2026-11-15):
 *   - Sealed bids. The first bid of a round starts a window of
 *     `bid_window_sec` (60 s); when it ends the LOWEST bid wins, ties go to
 *     the earliest bid. A round with no bid stays open.
 *   - "Claim now" skips bidding: the booster takes the order at the payout
 *     ceiling minus `claim_now_discount_bps` (25 %).
 *   - Bids go from the ceiling minus 24.5 % (`min_bid_bps` 7550) up to the
 *     ceiling (2026-11-24).
 *   - Priority orders: no bidding, instant claim at the full payout.
 *   - Preferred booster: during `preferredUntil` only that booster sees the
 *     order and claims it at the full payout; then it joins the pool.
 *   - Active orders per booster: BoosterProfile.maxConcurrentOrders, else
 *     config `max_concurrent_orders` (1).
 *
 * The payout ceiling is the booster share reserved at payment (pricing
 * snapshot, minus any refund). Boosters never see the customer price. A
 * payout below the reservation moves the difference to the platform
 * (BOOSTER_BID_MARGIN ledger entries) when the order is taken.
 *
 * Every way of taking an order goes through `takeOrderTx` (one transaction:
 * booster row locked, capacity and trial checked, order PENDING -> CLAIMED
 * conditional on its bidding round, bids settled, margin posted).
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { toDecimalString } from "@/lib/money";
import { VERIFIED_PAYMENT_WHERE } from "@/lib/orders/payment-gate";
import { transitionOrder } from "@/lib/orders/transitions";
import { canClaimNewOrders } from "@/lib/boosters/status";
import { postLedger } from "@/lib/finance/ledger";
import { createNotification, createNotificationsForEvent } from "@/lib/notifications/service";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import { logger } from "@/lib/logger";
import { signalPool } from "@/lib/realtime/live";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  BoosterNotEligibleError,
  OrderAlreadyClaimedError,
  OrderNotClaimableError,
  OrderNotFoundError,
} from "@/lib/assignments/types";
import { ELIGIBILITY_MESSAGE, eligibilityProblem, payoutAmounts, type PermissionLike } from "./eligibility";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type AwardMode = "BID" | "CLAIM_NOW" | "PRIORITY" | "PREFERRED";

export class PoolError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "PoolError";
  }
}

/* ------------------------------------------------------------------ */
/* Booster                                                             */
/* ------------------------------------------------------------------ */

export interface BoosterForPool {
  id: string;
  status: string;
  trialOrdersRemaining: number | null;
  limit: number;
  activeCount: number;
  permissions: PermissionLike[];
}

export async function loadBoosterForPool(boosterId: string, db: Db = prisma): Promise<BoosterForPool> {
  const user = await db.user.findUnique({
    where: { id: boosterId },
    include: { boosterProfile: { include: { permissions: true } } },
  });
  if (!user || user.role !== "BOOSTER" || !user.boosterProfile) throw new BoosterNotEligibleError("Booster profile not found");
  const p = user.boosterProfile;
  const [limit, activeCount] = await Promise.all([
    p.maxConcurrentOrders ?? getConfig("max_concurrent_orders"),
    db.orderBoosterAssignment.count({ where: { boosterId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } }),
  ]);
  return {
    id: boosterId,
    status: p.verificationStatus,
    trialOrdersRemaining: p.trialOrdersRemaining ?? null,
    limit,
    activeCount,
    permissions: (p.permissions ?? []) as PermissionLike[],
  };
}

/** Why this booster cannot take any new order right now (null = can). */
export function boosterBlockReason(b: BoosterForPool): string | null {
  if (!canClaimNewOrders(b.status, b.trialOrdersRemaining)) {
    if (b.status === "ON_BREAK") return "You are on a break. End your break to take new orders.";
    if (b.status === "TRIAL") return "Your trial orders are used up. An admin will review your trial before you can take more.";
    return "Your booster account cannot take new orders.";
  }
  if (b.activeCount >= b.limit) {
    return b.limit === 1 ? "Finish your current order before taking a new one." : `You already have ${b.activeCount} active orders (your limit is ${b.limit}).`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

const POOL_ORDER_SELECT = {
  id: true,
  userId: true,
  gameSlug: true,
  serviceSlug: true,
  configuration: true,
  selectedMode: true,
  selectedOptions: true,
  championsRoles: true,
  createdAt: true,
  status: true,
  paymentVerifiedAt: true,
  isPriority: true,
  biddingRound: true,
  biddingClosesAt: true,
  preferredBoosterId: true,
  preferredUntil: true,
  riotAccount: { select: { platform: true } },
  pricingSnapshot: { select: { boosterShareAmount: true, currency: true } },
  boosterEarnings: {
    where: { reservationKey: { not: null } },
    select: { grossAmount: true, reversedAmount: true, status: true, currency: true },
  },
} satisfies Prisma.OrderSelect;

type PoolOrderRow = Prisma.OrderGetPayload<{ select: typeof POOL_ORDER_SELECT }>;

/** Booster share still reserved for the order (minor units). */
export function payoutCeilingOf(order: Pick<PoolOrderRow, "pricingSnapshot" | "boosterEarnings">): { ceiling: number; currency: string } {
  const res = order.boosterEarnings?.find((e) => e.status === "RESERVED");
  if (res) return { ceiling: res.grossAmount - res.reversedAmount, currency: res.currency };
  return { ceiling: order.pricingSnapshot?.boosterShareAmount ?? 0, currency: order.pricingSnapshot?.currency ?? "EUR" };
}

function preferredActive(order: { preferredBoosterId: string | null; preferredUntil: Date | null }, now: Date) {
  return !!order.preferredBoosterId && !!order.preferredUntil && order.preferredUntil > now;
}

async function pricingConfig() {
  const [claimNowDiscountBps, minBidBps, windowSec] = await Promise.all([
    getConfig("claim_now_discount_bps"),
    getConfig("min_bid_bps"),
    getConfig("bid_window_sec"),
  ]);
  return { claimNowDiscountBps, minBidBps, windowSec };
}

export interface PoolOrder {
  id: string;
  gameSlug: string;
  serviceSlug: string;
  configuration: unknown;
  selectedMode: string | null;
  selectedOptions: string[];
  championsRoles: unknown;
  createdAt: Date;
  region: string | null;
  isPriority: boolean;
  /** Only for the chosen booster, during the exclusive window. */
  preferredForMe: boolean;
  preferredUntil: Date | null;
  currency: string;
  payoutCeiling: number;
  claimNowAmount: number;
  minBid: number;
  biddingClosesAt: Date | null;
  /** Number of active bids. */
  bidCount: number;
  /** Lowest active bid of the round (decision 2026-11-16: bids are visible). */
  lowestBid: number | null;
  myBid: number | null;
}

/**
 * The pool for one booster: paid PENDING orders nobody holds, that this
 * booster is allowed to take (rank ceiling, region, service), never one they
 * held before, and during a preferred window only for the chosen booster.
 */
export async function getPoolForBooster(boosterId: string, filters: { gameSlug?: string } = {}) {
  await closeDueBidding().catch((e) => logger.warn("closeDueBidding failed", { error: e instanceof Error ? e.message : "unknown" }));
  const booster = await loadBoosterForPool(boosterId);
  const blockedReason = boosterBlockReason(booster);
  const now = new Date();

  const rows = await prisma.order.findMany({
    where: {
      status: "PENDING",
      ...VERIFIED_PAYMENT_WHERE,
      ...(filters.gameSlug && filters.gameSlug !== "all" ? { gameSlug: filters.gameSlug } : {}),
      assignments: { none: { OR: [{ status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, { boosterId }] } },
      OR: [{ preferredBoosterId: null }, { preferredUntil: null }, { preferredUntil: { lte: now } }, { preferredBoosterId: boosterId }],
    },
    select: POOL_ORDER_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const visible = rows.filter(
    (o) =>
      eligibilityProblem(booster.permissions, { gameSlug: o.gameSlug, serviceSlug: o.serviceSlug, configuration: o.configuration, region: o.riotAccount?.platform }) === null
  );
  const cfg = await pricingConfig();

  const [counts, mine] = await Promise.all([
    prisma.orderBid.groupBy({
      by: ["orderId"],
      where: { orderId: { in: visible.map((o) => o.id) }, status: "ACTIVE" },
      _count: { _all: true },
      _min: { amount: true },
    }),
    prisma.orderBid.findMany({
      where: { boosterId, orderId: { in: visible.map((o) => o.id) }, status: "ACTIVE" },
      select: { orderId: true, round: true, amount: true },
    }),
  ]);
  const countBy = new Map(counts.map((c) => [c.orderId, c._count._all]));
  const lowestBy = new Map(counts.map((c) => [c.orderId, c._min.amount ?? null]));

  const orders: PoolOrder[] = visible.map((o) => {
    const { ceiling, currency } = payoutCeilingOf(o);
    const amounts = payoutAmounts(ceiling, cfg);
    const preferredForMe = preferredActive(o, now) && o.preferredBoosterId === boosterId;
    return {
      id: o.id,
      gameSlug: o.gameSlug,
      serviceSlug: o.serviceSlug,
      configuration: o.configuration,
      selectedMode: o.selectedMode,
      selectedOptions: o.selectedOptions,
      championsRoles: o.championsRoles,
      createdAt: o.createdAt,
      region: o.riotAccount?.platform ?? null,
      isPriority: o.isPriority,
      preferredForMe,
      preferredUntil: preferredForMe ? o.preferredUntil : null,
      currency,
      payoutCeiling: amounts.ceiling,
      claimNowAmount: amounts.claimNow,
      minBid: amounts.minBid,
      biddingClosesAt: o.biddingClosesAt,
      bidCount: countBy.get(o.id) ?? 0,
      lowestBid: lowestBy.get(o.id) ?? null,
      myBid: mine.find((b) => b.orderId === o.id && b.round === o.biddingRound)?.amount ?? null,
    };
  });
  orders.sort(
    (a, b) =>
      Number(b.preferredForMe) - Number(a.preferredForMe) ||
      Number(b.isPriority) - Number(a.isPriority) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );
  return { orders, blockedReason, limit: booster.limit, activeCount: booster.activeCount, bidWindowSec: cfg.windowSec };
}

/** Load an order the booster wants to act on; 404 when they may not see it. */
async function loadOrderForBooster(db: Db, orderId: string, booster: BoosterForPool, now: Date) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: POOL_ORDER_SELECT });
  if (!order) throw new OrderNotFoundError(orderId);
  const problem = eligibilityProblem(booster.permissions, {
    gameSlug: order.gameSlug,
    serviceSlug: order.serviceSlug,
    configuration: order.configuration,
    region: order.riotAccount?.platform,
  });
  if (problem) throw new PoolError(ELIGIBILITY_MESSAGE[problem], 403, problem);
  if (preferredActive(order, now) && order.preferredBoosterId !== booster.id) {
    throw new PoolError("This order is reserved for another booster for a few minutes.", 404, "NOT_FOUND");
  }
  const heldBefore = await db.orderBoosterAssignment.findFirst({ where: { orderId, boosterId: booster.id }, select: { id: true } });
  if (heldBefore) throw new PoolError("You already worked on this order; it cannot be taken again.", 404, "NOT_FOUND");
  if (order.status !== "PENDING") throw new OrderNotClaimableError(`order is ${order.status}, expected PENDING`);
  if (!order.paymentVerifiedAt) throw new OrderNotClaimableError("payment has not been verified");
  return order;
}

function assertCanTakeMore(booster: BoosterForPool) {
  const reason = boosterBlockReason(booster);
  if (reason) throw new PoolError(reason, booster.activeCount >= booster.limit ? 409 : 403, booster.activeCount >= booster.limit ? "LIMIT_REACHED" : "NOT_ELIGIBLE");
}

/* ------------------------------------------------------------------ */
/* Bids                                                                */
/* ------------------------------------------------------------------ */

/** Place or change the booster's sealed bid for the current round. */
export async function placeBid(boosterId: string, orderId: string, amount: number) {
  const placed = await placeBidTx(boosterId, orderId, amount);
  // Live: other boosters see the new lowest bid and countdown.
  await signalPool("bid");
  return placed;
}

async function placeBidTx(boosterId: string, orderId: string, amount: number) {
  await closeDueBidding(orderId);
  const booster = await loadBoosterForPool(boosterId);
  assertCanTakeMore(booster);
  const now = new Date();
  const cfg = await pricingConfig();

  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForBooster(tx, orderId, booster, now);
    if (order.isPriority) throw new PoolError("Priority orders are not auctioned: claim it directly.", 409, "PRIORITY_ORDER");
    if (preferredActive(order, now)) throw new PoolError("This order is offered to you directly: claim it.", 409, "PREFERRED_ORDER");
    if (order.biddingClosesAt && order.biddingClosesAt <= now) throw new PoolError("Bidding for this order has closed.", 409, "WINDOW_CLOSED");
    const { ceiling, currency } = payoutCeilingOf(order);
    const { minBid } = payoutAmounts(ceiling, cfg);
    if (!Number.isSafeInteger(amount) || amount < minBid || amount > ceiling) {
      throw new PoolError(
        `Your bid must be between ${toDecimalString(minBid, currency)} and ${toDecimalString(ceiling, currency)} ${currency}.`,
        422,
        "AMOUNT_OUT_OF_RANGE",
      );
    }
    const round = Math.max(order.biddingRound, 1);
    // Bids are visible: a new bid must beat the lowest bid of the other boosters.
    const others = await tx.orderBid.aggregate({
      where: { orderId, round, status: "ACTIVE", boosterId: { not: boosterId } },
      _min: { amount: true },
    });
    const lowest = others._min.amount;
    if (lowest !== null && amount >= lowest) {
      throw new PoolError(`Your bid must be lower than the current lowest bid (${(lowest / 100).toFixed(2)}).`, 422, "BID_NOT_LOWER");
    }
    const existing = await tx.orderBid.findUnique({ where: { orderId_boosterId_round: { orderId, boosterId, round } } });
    if (existing && existing.status !== "ACTIVE" && existing.status !== "WITHDRAWN") {
      throw new PoolError("Bidding for this order has closed.", 409, "WINDOW_CLOSED");
    }
    const bid = existing
      ? await tx.orderBid.update({
          where: { id: existing.id, status: existing.status },
          data: { amount, status: "ACTIVE", editCount: { increment: 1 } },
        })
      : await tx.orderBid.create({ data: { orderId, boosterId, round, amount, currency, status: "ACTIVE" } });

    // The first bid of the round starts the window (conditional: one wins).
    let closesAt = order.biddingClosesAt;
    if (!closesAt || order.biddingRound < 1) {
      closesAt = new Date(now.getTime() + cfg.windowSec * 1000);
      await tx.order.updateMany({
        where: { id: orderId, status: "PENDING", biddingRound: order.biddingRound, biddingClosesAt: null },
        data: { biddingClosesAt: closesAt, biddingRound: round },
      });
      const fresh = await tx.order.findUnique({ where: { id: orderId }, select: { biddingClosesAt: true } });
      closesAt = fresh?.biddingClosesAt ?? closesAt;
    }
    return { bidId: bid.id, amount: bid.amount, currency, closesAt };
  });
}

export async function withdrawBid(boosterId: string, orderId: string) {
  const now = new Date();
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { biddingRound: true, biddingClosesAt: true } });
  if (!order) throw new OrderNotFoundError(orderId);
  if (order.biddingClosesAt && order.biddingClosesAt <= now) throw new PoolError("Bidding for this order has closed.", 409, "WINDOW_CLOSED");
  const res = await prisma.orderBid.updateMany({
    where: { orderId, boosterId, round: Math.max(order.biddingRound, 1), status: "ACTIVE" },
    data: { status: "WITHDRAWN" },
  });
  if (res.count === 0) throw new PoolError("You have no active bid on this order.", 404, "NO_BID");
  await signalPool("bid");
  return { withdrawn: true };
}

/* ------------------------------------------------------------------ */
/* Taking an order                                                     */
/* ------------------------------------------------------------------ */

/**
 * Move the part of the reservation above the agreed payout to the platform.
 * Skipped when part of the share was already reversed (refund before the
 * order was taken): the booster keeps the remaining share.
 */
async function applyBidMargin(tx: Tx, orderId: string, payout: number, round: number) {
  const res = await tx.boosterEarning.findUnique({ where: { reservationKey: orderId } });
  if (!res || res.status !== "RESERVED") return { payout, margin: 0, recorded: payout };
  const net = res.grossAmount - res.reversedAmount;
  if (payout >= net || res.reversedAmount > 0) return { payout: net, margin: 0, recorded: null };
  const margin = net - payout;
  await tx.boosterEarning.update({ where: { id: res.id, status: "RESERVED", grossAmount: res.grossAmount }, data: { grossAmount: payout } });
  await postLedger(tx, [
    {
      type: "BOOSTER_BID_MARGIN", account: "BOOSTER_POOL", amount: -margin, currency: res.currency,
      idempotencyKey: `order:${orderId}:bid-margin:${round}:pool`, orderId, earningId: res.id,
      description: "Booster payout below the reserved share",
    },
    {
      type: "BOOSTER_BID_MARGIN", account: "PLATFORM_REVENUE", amount: margin, currency: res.currency,
      idempotencyKey: `order:${orderId}:bid-margin:${round}:platform`, orderId, earningId: res.id,
      description: "Booster payout below the reserved share",
    },
  ]);
  return { payout, margin, recorded: payout };
}

/**
 * The booster who agreed a lower payout left the order: move the margin the
 * platform kept back into the booster share, so the next booster sees the
 * full payout again. Idempotent per assignment; no-op without a margin.
 */
export async function restoreBidMargin(tx: Tx, orderId: string, assignmentId: string) {
  const res = await tx.boosterEarning.findUnique({ where: { reservationKey: orderId } });
  if (!res || res.status !== "RESERVED") return 0;
  const agg = await tx.financialTransaction.aggregate({
    where: { orderId, type: "BOOSTER_BID_MARGIN", account: "PLATFORM_REVENUE" },
    _sum: { amount: true },
  });
  const margin = agg._sum.amount ?? 0;
  if (margin <= 0) return 0;
  await tx.boosterEarning.update({ where: { id: res.id, grossAmount: res.grossAmount }, data: { grossAmount: res.grossAmount + margin } });
  await postLedger(tx, [
    {
      type: "BOOSTER_BID_MARGIN", account: "PLATFORM_REVENUE", amount: -margin, currency: res.currency,
      idempotencyKey: `order:${orderId}:bid-margin-restore:${assignmentId}:platform`, orderId, earningId: res.id,
      description: "Booster left the order: payout ceiling restored",
    },
    {
      type: "BOOSTER_BID_MARGIN", account: "BOOSTER_POOL", amount: margin, currency: res.currency,
      idempotencyKey: `order:${orderId}:bid-margin-restore:${assignmentId}:pool`, orderId, earningId: res.id,
      description: "Booster left the order: payout ceiling restored",
    },
  ]);
  await tx.order.update({ where: { id: orderId }, data: { boosterPayoutAmount: null } });
  return margin;
}

/**
 * One transaction for every way of taking an order. Locks the booster row
 * (trial decrement or a no-op update), re-checks capacity, creates the
 * assignment and moves the order PENDING -> CLAIMED conditional on the
 * bidding round it was decided in.
 */
export async function takeOrderTx(
  tx: Tx,
  args: { orderId: string; boosterId: string; mode: AwardMode; payout: number; round: number; limit: number; winningBidId?: string }
) {
  const { orderId, boosterId } = args;
  const now = new Date();

  // Lock the booster row; TRIAL boosters use one trial order (never below 0).
  const trial = await tx.boosterProfile.updateMany({
    where: { userId: boosterId, verificationStatus: "TRIAL", trialOrdersRemaining: { gt: 0 } },
    data: { trialOrdersRemaining: { decrement: 1 } },
  });
  if (trial.count === 0) {
    const active = await tx.boosterProfile.updateMany({ where: { userId: boosterId, verificationStatus: "APPROVED" }, data: { updatedAt: now } });
    if (active.count === 0) throw new BoosterNotEligibleError("Your booster account cannot take new orders right now.");
  }
  const held = await tx.orderBoosterAssignment.count({ where: { boosterId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } });
  if (held >= args.limit) throw new PoolError("You have reached your active order limit.", 409, "LIMIT_REACHED");

  const taken = await tx.orderBoosterAssignment.findFirst({ where: { orderId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } });
  if (taken) throw new OrderAlreadyClaimedError();

  const money = await applyBidMargin(tx, orderId, args.payout, args.round);

  const assignment = await tx.orderBoosterAssignment.create({
    data: {
      orderId,
      boosterId,
      assignedById: boosterId,
      status: "ASSIGNED",
      activeOrderId: orderId,
      awardMode: args.mode,
      payoutAmount: money.payout,
    },
  });
  // Conditional on PENDING, a verified payment and the same bidding round.
  const order = await transitionOrder(tx, {
    where: { id: orderId, status: "PENDING", ...VERIFIED_PAYMENT_WHERE, biddingRound: args.round },
    to: "CLAIMED",
    data: { claimedAt: now, biddingClosesAt: null, ...(money.recorded !== null ? { boosterPayoutAmount: money.recorded } : {}) },
  });

  if (args.round > 0) {
    await tx.orderBid.updateMany({
      where: { orderId, round: args.round, status: "ACTIVE", ...(args.winningBidId ? { id: { not: args.winningBidId } } : {}) },
      data: { status: "LOST" },
    });
    if (args.winningBidId) await tx.orderBid.update({ where: { id: args.winningBidId }, data: { status: "WON" } });
  }

  await tx.orderEvent.create({
    data: {
      orderId,
      type: "BOOSTER_ASSIGNED",
      message: "A booster took the order",
      metadata: { assignmentId: assignment.id, boosterId, mode: args.mode },
    },
  });
  await tx.orderEvent.create({
    data: { orderId, type: "ORDER_CLAIMED", message: "Order claimed by booster", metadata: { assignmentId: assignment.id, boosterId, mode: args.mode } },
  });
  return { assignment, order, payout: money.payout };
}

/** Notifications and realtime after a take committed (never throws). */
async function afterTake(result: { assignment: { id: string; boosterId: string; status: string; assignedAt: Date }; order: { id: string; userId: string } }, losers: string[] = []) {
  try {
    await createNotificationsForEvent({
      type: "BOOSTER_ASSIGNED",
      orderId: result.order.id,
      assignmentId: result.assignment.id,
      actorId: result.assignment.boosterId,
    });
    await Promise.all(losers.map((id) => createNotification(id, "BID_LOST", result.order.id, undefined, "system")));
    await broadcastToOrder({
      orderId: result.order.id,
      event: "order.assigned",
      payload: {
        orderId: result.order.id,
        customerId: result.order.userId,
        boosterId: result.assignment.boosterId,
        assignedById: result.assignment.boosterId,
        assignmentId: result.assignment.id,
        status: result.assignment.status,
        assignedAt: result.assignment.assignedAt.toISOString(),
      },
    });
    // Live: the order leaves every booster's available list.
    await signalPool("removed");
  } catch (e) {
    logger.warn("Post-claim side effects failed", { orderId: result.order.id, error: e instanceof Error ? e.message : "unknown" });
  }
}

function mapTakeError(e: unknown): never {
  const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
  if (code === "P2002") throw new OrderAlreadyClaimedError();
  if (code === "P2025") throw new OrderNotClaimableError("order is no longer available");
  throw e;
}

/**
 * Take an order immediately: priority (full payout), preferred booster
 * (full payout, during the window) or claim now (ceiling minus the
 * claim-now discount). Ends the current bidding round.
 */
export async function claimNow(boosterId: string, orderId: string) {
  await closeDueBidding(orderId);
  const booster = await loadBoosterForPool(boosterId);
  assertCanTakeMore(booster);
  const now = new Date();
  const cfg = await pricingConfig();

  let losers: string[] = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await loadOrderForBooster(tx, orderId, booster, now);
      if (order.biddingClosesAt && order.biddingClosesAt <= now) {
        throw new PoolError("Bidding just closed for this order; the winner is being selected.", 409, "WINDOW_CLOSED");
      }
      const { ceiling } = payoutCeilingOf(order);
      const amounts = payoutAmounts(ceiling, cfg);
      const mode: AwardMode = preferredActive(order, now) ? "PREFERRED" : order.isPriority ? "PRIORITY" : "CLAIM_NOW";
      const payout = mode === "CLAIM_NOW" ? amounts.claimNow : amounts.ceiling;
      const bidders = await tx.orderBid.findMany({
        where: { orderId, round: order.biddingRound, status: "ACTIVE", boosterId: { not: boosterId } },
        select: { boosterId: true },
      });
      losers = bidders.map((b) => b.boosterId);
      return takeOrderTx(tx, { orderId, boosterId, mode, payout, round: order.biddingRound, limit: booster.limit });
    });
    await afterTake(result, losers);
    return result;
  } catch (e) {
    mapTakeError(e);
  }
}

/* ------------------------------------------------------------------ */
/* Award                                                               */
/* ------------------------------------------------------------------ */

/**
 * Award every order whose bidding window has ended (or one order). The
 * lowest active bid wins, ties to the earliest; a bidder who can no longer
 * take it (limit reached, status changed, permission removed) is skipped.
 * No eligible bid: the round stays open for new bids. Safe to run often and
 * concurrently: the award is conditional on the round.
 */
export async function closeDueBidding(orderId?: string, now = new Date()) {
  const due = await prisma.order.findMany({
    where: { status: "PENDING", biddingClosesAt: { lte: now }, ...(orderId ? { id: orderId } : {}) },
    select: { id: true, biddingRound: true },
    take: 50,
  });
  let awarded = 0;
  let reopened = 0;
  for (const o of due) {
    const outcome = await awardOrder(o.id, o.biddingRound, now);
    if (outcome === "awarded") awarded++;
    else if (outcome === "reopened") reopened++;
  }
  return { due: due.length, awarded, reopened };
}

async function awardOrder(orderId: string, round: number, now: Date): Promise<"awarded" | "reopened" | "skipped"> {
  const bids = await prisma.orderBid.findMany({
    where: { orderId, round, status: "ACTIVE" },
    orderBy: [{ amount: "asc" }, { createdAt: "asc" }],
  });
  for (const bid of bids) {
    let booster: BoosterForPool;
    try {
      booster = await loadBoosterForPool(bid.boosterId);
      assertCanTakeMore(booster);
    } catch {
      await prisma.orderBid.updateMany({ where: { id: bid.id, status: "ACTIVE" }, data: { status: "LOST" } });
      continue;
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        await loadOrderForBooster(tx, orderId, booster, now);
        return takeOrderTx(tx, { orderId, boosterId: bid.boosterId, mode: "BID", payout: bid.amount, round, limit: booster.limit, winningBidId: bid.id });
      });
      const losers = bids.filter((b) => b.id !== bid.id).map((b) => b.boosterId);
      await afterTake(result, losers);
      await createNotification(bid.boosterId, "BID_WON", orderId, undefined, "system").catch(() => {});
      return "awarded";
    } catch (e) {
      if (e instanceof OrderNotClaimableError || (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2025")) {
        return "skipped"; // taken another way meanwhile (claim now / another closer)
      }
      if (e instanceof OrderAlreadyClaimedError) return "skipped";
      logger.warn("Bid could not be awarded; trying the next one", { orderId, error: e instanceof Error ? e.message : "unknown" });
      await prisma.orderBid.updateMany({ where: { id: bid.id, status: "ACTIVE" }, data: { status: "LOST" } });
    }
  }
  // Nobody could take it: keep the round open for new bids.
  const reopened = await prisma.order.updateMany({
    where: { id: orderId, status: "PENDING", biddingRound: round, biddingClosesAt: { lte: now } },
    data: { biddingClosesAt: null },
  });
  if (reopened.count > 0) await signalPool("bid");
  return reopened.count > 0 ? "reopened" : "skipped";
}

/** Error -> HTTP response body/status for the pool routes. */
export function poolErrorStatus(e: unknown): { status: number; error: string; code?: string } {
  if (e instanceof PoolError) return { status: e.status, error: e.message, code: e.code };
  if (e instanceof OrderNotFoundError) return { status: 404, error: "Order not found" };
  if (e instanceof OrderAlreadyClaimedError) return { status: 409, error: e.message, code: "ALREADY_CLAIMED" };
  if (e instanceof OrderNotClaimableError) return { status: 409, error: "This order is no longer available.", code: "NOT_AVAILABLE" };
  if (e instanceof BoosterNotEligibleError) return { status: 403, error: e.message, code: "NOT_ELIGIBLE" };
  return { status: 500, error: "Something went wrong" };
}
