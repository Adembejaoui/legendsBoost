/**
 * Booster earnings.
 *
 *   payment verified  -> one RESERVED earning per order (the 55% share, no
 *                        booster yet) + ledger BOOSTER_POOL
 *   order completed   -> exactly one booster ever started work on it:
 *                          the reservation is attributed to that booster
 *                          (PENDING) and moved BOOSTER_POOL -> BOOSTER_PAYABLE
 *                        several boosters worked on it (abandonment,
 *                        reassignment): PENDING_REVIEW, an admin allocates
 *                        per assignment. The final booster never receives
 *                        the whole share automatically.
 *   admin approval    -> AVAILABLE (release policy below)
 *   payout            -> IN_PAYOUT -> PAID (lib/finance/payouts.ts)
 *
 * Release policy (no holding period or automatic release has been decided
 * by the business, so the safe default is manual): an earning becomes
 * AVAILABLE only when an ADMIN approves it, the order is COMPLETED, and the
 * order has no open dispute and no pending refund.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { allocateProRata } from "@/lib/money";
import { postLedger } from "./ledger";
import { writeAudit } from "./audit";
import { enqueueOutbox, notifyAdmins } from "@/lib/payments/outbox";

export const EARNING_RELEASE_POLICY = {
  mode: "MANUAL_ADMIN_APPROVAL",
  requireOrderCompleted: true,
  blockOnOpenDispute: true,
  blockOnPendingRefund: true,
} as const;

export class EarningError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "EarningError";
  }
}

type Tx = Prisma.TransactionClient;

async function hasOpenDispute(tx: Tx, orderId: string) {
  return (await tx.dispute.count({ where: { orderId, status: "OPEN" } })) > 0;
}

/** Called inside the payment-success transaction. */
export async function reserveBoosterShare(
  tx: Tx,
  order: { id: string },
  snapshot: { boosterShareAmount: number; currency: string; platformFeeBps: number; boosterShareBps: number }
) {
  await tx.boosterEarning.create({
    data: {
      orderId: order.id,
      reservationKey: order.id,
      grossAmount: snapshot.boosterShareAmount,
      currency: snapshot.currency,
      platformFeeBps: snapshot.platformFeeBps,
      boosterShareBps: snapshot.boosterShareBps,
      status: "RESERVED",
    },
  });
}

/**
 * Called inside completeAssignment's transaction. No-op for orders without a
 * reservation (legacy / unpaid orders): they never produce earnings.
 */
export async function allocateOnCompletion(tx: Tx, orderId: string, completingAssignmentId: string) {
  const reservation = await tx.boosterEarning.findUnique({ where: { reservationKey: orderId } });
  if (!reservation || reservation.status !== "RESERVED") return { outcome: "no_reservation" as const };

  const contributors = await tx.orderBoosterAssignment.findMany({
    where: { orderId, startedAt: { not: null } },
    select: { id: true, boosterId: true },
  });
  const net = reservation.grossAmount - reservation.reversedAmount;

  if (contributors.length === 1 && contributors[0].id === completingAssignmentId) {
    const boosterId = contributors[0].boosterId;
    const disputed = await hasOpenDispute(tx, orderId);
    await tx.boosterEarning.update({
      where: { id: reservation.id, status: "RESERVED" },
      data: {
        boosterId,
        assignmentId: completingAssignmentId,
        status: disputed ? "ON_HOLD" : "PENDING",
        holdReason: disputed ? "DISPUTE" : null,
        allocationNote: "Single booster completed the order",
      },
    });
    await postLedger(tx, [
      {
        type: "BOOSTER_EARNING_ALLOCATED", account: "BOOSTER_POOL", amount: -net, currency: reservation.currency,
        idempotencyKey: `earning:${reservation.id}:allocate:pool`, orderId, earningId: reservation.id, boosterId,
      },
      {
        type: "BOOSTER_EARNING_ALLOCATED", account: "BOOSTER_PAYABLE", amount: net, currency: reservation.currency,
        idempotencyKey: `earning:${reservation.id}:allocate:payable`, orderId, earningId: reservation.id, boosterId,
      },
    ]);
    return { outcome: "allocated" as const, boosterId };
  }

  await tx.boosterEarning.update({
    where: { id: reservation.id, status: "RESERVED" },
    data: { status: "PENDING_REVIEW", allocationNote: `${contributors.length} boosters worked on this order` },
  });
  await enqueueOutbox(tx, [
    notifyAdmins(`earning-review:${reservation.id}`, "booster earnings need a manual allocation (several boosters worked on the order)", orderId),
  ]);
  return { outcome: "needs_review" as const };
}

async function assertAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u || u.role !== "ADMIN") throw new EarningError("Only administrators can manage earnings.", 403);
}

/**
 * Admin splits a PENDING_REVIEW earning across the assignments that worked
 * on the order. Amounts are integers in minor units and must sum exactly to
 * the remaining (non-reversed) share. The original row is kept as SPLIT.
 */
export async function allocateEarningByAdmin(
  adminId: string,
  earningId: string,
  allocations: { assignmentId: string; amount: number }[],
  note: string
) {
  await assertAdmin(adminId);
  const reason = note?.trim();
  if (!reason || reason.length < 3) throw new EarningError("An allocation note is required.", 400);
  if (!allocations.length) throw new EarningError("At least one allocation is required.", 400);
  if (allocations.some((a) => !Number.isSafeInteger(a.amount) || a.amount < 0)) {
    throw new EarningError("Allocation amounts must be non-negative integers (minor units).", 400);
  }
  if (new Set(allocations.map((a) => a.assignmentId)).size !== allocations.length) {
    throw new EarningError("Each assignment can only be allocated once.", 400);
  }

  return prisma.$transaction(async (tx) => {
    const earning = await tx.boosterEarning.findUnique({ where: { id: earningId } });
    if (!earning) throw new EarningError("Earning not found.", 404);
    if (earning.status !== "PENDING_REVIEW") throw new EarningError("Only earnings awaiting review can be allocated.", 409);
    const net = earning.grossAmount - earning.reversedAmount;
    const total = allocations.reduce((a, b) => a + b.amount, 0);
    if (total !== net) throw new EarningError(`Allocations must sum to ${net} (got ${total}).`, 400);

    const assignments = await tx.orderBoosterAssignment.findMany({
      where: { id: { in: allocations.map((a) => a.assignmentId) }, orderId: earning.orderId, startedAt: { not: null } },
      select: { id: true, boosterId: true },
    });
    if (assignments.length !== allocations.length) {
      throw new EarningError("Every allocation must reference an assignment that worked on this order.", 400);
    }
    const boosterOf = new Map(assignments.map((a) => [a.id, a.boosterId]));
    const disputed = await hasOpenDispute(tx, earning.orderId);

    await tx.boosterEarning.update({ where: { id: earning.id, status: "PENDING_REVIEW" }, data: { status: "SPLIT", allocationNote: reason } });
    const children = [];
    for (const a of allocations) {
      if (a.amount === 0) continue;
      const boosterId = boosterOf.get(a.assignmentId)!;
      const child = await tx.boosterEarning.create({
        data: {
          orderId: earning.orderId,
          boosterId,
          assignmentId: a.assignmentId,
          parentEarningId: earning.id,
          grossAmount: a.amount,
          currency: earning.currency,
          platformFeeBps: earning.platformFeeBps,
          boosterShareBps: earning.boosterShareBps,
          status: disputed ? "ON_HOLD" : "PENDING",
          holdReason: disputed ? "DISPUTE" : null,
          allocationNote: reason,
        },
      });
      children.push(child);
      await postLedger(tx, [
        {
          type: "BOOSTER_EARNING_ALLOCATED", account: "BOOSTER_POOL", amount: -a.amount, currency: earning.currency,
          idempotencyKey: `earning:${child.id}:allocate:pool`, orderId: earning.orderId, earningId: child.id, boosterId, createdById: adminId,
        },
        {
          type: "BOOSTER_EARNING_ALLOCATED", account: "BOOSTER_PAYABLE", amount: a.amount, currency: earning.currency,
          idempotencyKey: `earning:${child.id}:allocate:payable`, orderId: earning.orderId, earningId: child.id, boosterId, createdById: adminId,
        },
      ]);
    }
    await writeAudit(tx, {
      actorId: adminId, action: "EARNING_ALLOCATED", entityType: "boosterEarning", entityId: earning.id,
      details: { allocations, note: reason },
    });
    return children;
  });
}

/** Admin releases a PENDING earning (release policy above). */
export async function approveEarning(adminId: string, earningId: string) {
  await assertAdmin(adminId);
  return prisma.$transaction(async (tx) => {
    const earning = await tx.boosterEarning.findUnique({ where: { id: earningId }, include: { order: { select: { status: true } } } });
    if (!earning) throw new EarningError("Earning not found.", 404);
    if (earning.status !== "PENDING") throw new EarningError(`Earning is ${earning.status}, not PENDING.`, 409);
    if (EARNING_RELEASE_POLICY.requireOrderCompleted && earning.order.status !== "COMPLETED") {
      throw new EarningError("The order is not completed.", 409);
    }
    if (EARNING_RELEASE_POLICY.blockOnOpenDispute && (await hasOpenDispute(tx, earning.orderId))) {
      throw new EarningError("The order has an open dispute.", 409);
    }
    if (EARNING_RELEASE_POLICY.blockOnPendingRefund && (await tx.refund.count({ where: { orderId: earning.orderId, status: "PENDING" } })) > 0) {
      throw new EarningError("The order has a pending refund.", 409);
    }
    if (earning.grossAmount - earning.reversedAmount <= 0) throw new EarningError("Nothing left to release.", 409);
    const now = new Date();
    const updated = await tx.boosterEarning.update({
      where: { id: earning.id, status: "PENDING" },
      data: { status: "AVAILABLE", approvedAt: now, approvedById: adminId, releasedAt: now },
    });
    await writeAudit(tx, { actorId: adminId, action: "EARNING_APPROVED", entityType: "boosterEarning", entityId: earning.id });
    await enqueueOutbox(tx, [
      {
        type: "NOTIFY",
        dedupeKey: `earning-available:${earning.id}`,
        payload: { notification: "EARNING_AVAILABLE", recipients: [earning.boosterId!], orderId: earning.orderId, actorId: adminId },
      },
    ]);
    return updated;
  });
}

/** Dispute opened: pull releasable earnings of the order on hold. */
export async function holdEarningsForDispute(tx: Tx, orderId: string) {
  await tx.boosterEarning.updateMany({
    where: { orderId, status: { in: ["PENDING", "AVAILABLE"] } },
    data: { status: "ON_HOLD", holdReason: "DISPUTE" },
  });
}

/** Dispute won and no other dispute open: back to PENDING (re-approval). */
export async function releaseDisputeHold(tx: Tx, orderId: string) {
  if (await hasOpenDispute(tx, orderId)) return;
  await tx.boosterEarning.updateMany({
    where: { orderId, status: "ON_HOLD", holdReason: "DISPUTE" },
    data: { status: "PENDING", holdReason: null },
  });
}

/**
 * Apply a booster-share reversal (refund or dispute loss) across the order's
 * earnings, pro rata to what is left on each, and post the matching ledger
 * entries. Already paid earnings are reversed in the ledger too: the booster
 * balance goes negative and is netted against future payouts (never by
 * editing a balance).
 */
export async function distributeBoosterReversal(
  tx: Tx,
  input: { orderId: string; amount: number; currency: string; keyPrefix: string; type: "BOOSTER_SHARE_REVERSAL"; refundId?: string; disputeId?: string }
) {
  if (input.amount <= 0) return;
  const earnings = await tx.boosterEarning.findMany({
    where: { orderId: input.orderId, status: { notIn: ["SPLIT", "REVERSED"] } },
    orderBy: { createdAt: "asc" },
  });
  const remaining = earnings.map((e) => e.grossAmount - e.reversedAmount);
  const capacity = remaining.reduce((a, b) => a + b, 0);
  const toDistribute = Math.min(input.amount, capacity);
  const parts = toDistribute > 0 ? allocateProRata(toDistribute, remaining) : earnings.map(() => 0);
  const touchedBoosters = new Set<string>();

  for (let i = 0; i < earnings.length; i++) {
    const e = earnings[i];
    const part = parts[i];
    if (part <= 0) continue;
    const reversedAmount = e.reversedAmount + part;
    const fullyReversed = reversedAmount === e.grossAmount;
    const releasable = ["RESERVED", "PENDING_REVIEW", "PENDING", "ON_HOLD", "AVAILABLE"].includes(e.status);
    await tx.boosterEarning.update({
      where: { id: e.id, reversedAmount: e.reversedAmount },
      data: { reversedAmount, ...(fullyReversed && releasable ? { status: "REVERSED" } : {}) },
    });
    const unallocated = e.boosterId === null;
    if (e.boosterId) touchedBoosters.add(e.boosterId);
    await postLedger(tx, [
      {
        type: input.type,
        account: unallocated ? "BOOSTER_POOL" : "BOOSTER_PAYABLE",
        amount: -part,
        currency: input.currency,
        idempotencyKey: `${input.keyPrefix}:earning:${e.id}`,
        orderId: input.orderId,
        earningId: e.id,
        boosterId: e.boosterId,
        refundId: input.refundId ?? null,
        disputeId: input.disputeId ?? null,
      },
    ]);
  }
  // The boosters' open pages (balance, earnings) reload after commit.
  if (touchedBoosters.size > 0) {
    await enqueueOutbox(tx, [
      { type: "USER_SIGNAL", dedupeKey: `${input.keyPrefix}:booster-signal`, payload: { userIds: [...touchedBoosters], scope: "earnings" } },
    ]);
  }
  // Anything beyond the earnings' capacity (should not happen) stays visible
  // on the pool account rather than disappearing.
  const leftover = input.amount - toDistribute;
  if (leftover > 0) {
    await postLedger(tx, [
      {
        type: input.type, account: "BOOSTER_POOL", amount: -leftover, currency: input.currency,
        idempotencyKey: `${input.keyPrefix}:pool-leftover`, orderId: input.orderId,
        refundId: input.refundId ?? null, disputeId: input.disputeId ?? null,
        description: "Reversal beyond remaining earnings",
      },
    ]);
  }
}
