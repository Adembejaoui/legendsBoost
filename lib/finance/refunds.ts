/**
 * Refunds (full and partial) and the shared reversal logic used for refunds
 * and lost disputes.
 *
 * Nothing is deleted or rewritten: a refund is a new Refund row plus
 * compensating ledger entries. The split between platform and booster uses
 * cumulative figures (lib/money cumulativeShare), so any sequence of partial
 * refunds that adds up to the full amount reverses exactly the original
 * 45/55 split, with any rounding unit landing on the platform side.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { cumulativeShare } from "@/lib/money";
import { getStripe, safeErrorMessage, StripeConfigError } from "@/lib/stripe/server";
import { postLedger } from "./ledger";
import { writeAudit } from "./audit";
import { distributeBoosterReversal } from "./earnings";
import { enqueueOutbox, notifyAdmins, dispatchOutbox } from "@/lib/payments/outbox";
import { transitionOrder } from "@/lib/orders/transitions";

type Tx = Prisma.TransactionClient;

export class RefundError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RefundError";
  }
}

/** Customer money already returned or lost for a payment (refunds + lost disputes). */
async function reversedSoFar(tx: Tx, paymentId: string, excludeRefundId?: string, excludeDisputeId?: string) {
  const refunds = await tx.refund.aggregate({
    _sum: { amount: true },
    where: { paymentId, status: "SUCCEEDED", ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) },
  });
  const disputes = await tx.dispute.aggregate({
    _sum: { amount: true },
    where: { paymentId, status: "LOST", lossPostedAt: { not: null }, ...(excludeDisputeId ? { id: { not: excludeDisputeId } } : {}) },
  });
  return (refunds._sum.amount ?? 0) + (disputes._sum.amount ?? 0);
}

/**
 * Post the ledger reversal for `amount` leaving the customer (refund) or
 * taken back by the bank (dispute loss).
 */
export async function postReversal(
  tx: Tx,
  input: {
    kind: "REFUND" | "DISPUTE_LOSS";
    paymentId: string;
    amount: number;
    keyPrefix: string;
    refundId?: string;
    disputeId?: string;
  }
): Promise<{ platform: number; booster: number }> {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: { paidOrder: { include: { pricingSnapshot: true } } } });
  const currency = payment.currency;
  const customerEntry = {
    type: input.kind,
    account: "CUSTOMER_PAYMENTS" as const,
    amount: -input.amount,
    currency,
    idempotencyKey: `${input.keyPrefix}:customer`,
    orderId: payment.orderId,
    paymentId: payment.id,
    refundId: input.refundId ?? null,
    disputeId: input.disputeId ?? null,
  };

  const snapshot = payment.paidOrder?.pricingSnapshot;
  if (!payment.paidOrder || !snapshot) {
    // Money that was never applied to an order (amount mismatch, duplicate,
    // cancelled order): only the customer account moves.
    await postLedger(tx, [customerEntry]);
    return { platform: 0, booster: 0 };
  }

  const before = await reversedSoFar(tx, payment.id, input.refundId, input.disputeId);
  const base = snapshot.commissionBaseAmount;
  // Tax is 0 in this release; reversals are applied to the commission base.
  // A booster payout agreed below the reserved share (winning bid, claim
  // now) already moved the difference to the platform: reversals follow the
  // agreed payout, and the platform side absorbs the rest.
  const boosterShare = payment.paidOrder.boosterPayoutAmount ?? snapshot.boosterShareAmount;
  const boosterBefore = cumulativeShare(boosterShare, before, base);
  const boosterAfter = cumulativeShare(boosterShare, before + input.amount, base);
  const booster = boosterAfter - boosterBefore;
  const appliedToBase = Math.max(0, Math.min(before + input.amount, base) - Math.min(before, base));
  const platform = appliedToBase - booster;

  await postLedger(tx, [
    customerEntry,
    {
      type: "PLATFORM_COMMISSION_REVERSAL",
      account: "PLATFORM_REVENUE",
      amount: -platform,
      currency,
      idempotencyKey: `${input.keyPrefix}:platform`,
      orderId: payment.orderId,
      paymentId: payment.id,
      refundId: input.refundId ?? null,
      disputeId: input.disputeId ?? null,
    },
  ]);
  await distributeBoosterReversal(tx, {
    orderId: payment.orderId,
    amount: booster,
    currency,
    keyPrefix: input.keyPrefix,
    type: "BOOSTER_SHARE_REVERSAL",
    refundId: input.refundId,
    disputeId: input.disputeId,
  });
  return { platform, booster };
}

/**
 * Mark a refund SUCCEEDED and post its reversal exactly once. If the
 * payment is now fully returned and the order has not been worked on, the
 * order is cancelled so it can never be claimed.
 */
export async function finalizeRefundSucceeded(tx: Tx, refundId: string) {
  const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  if (refund.status === "SUCCEEDED") return { outcome: "already_succeeded" as const };
  if (refund.status !== "PENDING") return { outcome: `ignored_${refund.status.toLowerCase()}` as const };

  const split = await postReversal(tx, {
    kind: "REFUND",
    paymentId: refund.paymentId,
    amount: refund.amount,
    keyPrefix: `refund:${refund.id}`,
    refundId: refund.id,
  });
  await tx.refund.update({
    where: { id: refund.id, status: "PENDING" },
    data: { status: "SUCCEEDED", succeededAt: new Date(), platformReversalAmount: split.platform, boosterReversalAmount: split.booster },
  });
  const payment = await tx.payment.update({
    where: { id: refund.paymentId },
    data: { amountRefunded: { increment: refund.amount } },
    include: { order: { select: { id: true, status: true, userId: true, paidPaymentId: true } } },
  });

  const fullyRefunded = payment.amountRefunded >= (payment.amountReceived ?? payment.amount);
  const order = payment.order;
  if (fullyRefunded && order.paidPaymentId === payment.id) {
    if (["PENDING", "DRAFT"].includes(order.status)) {
      await transitionOrder(tx, { where: { id: order.id, status: order.status as "PENDING" | "DRAFT" }, to: "CANCELLED" });
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "ORDER_CANCELLED", message: "Order cancelled after a full refund", metadata: { refundId: refund.id, previousStatus: order.status } },
      });
    } else if (["CLAIMED", "IN_PROGRESS", "PAUSED"].includes(order.status)) {
      await enqueueOutbox(tx, [notifyAdmins(`refund-active-order:${refund.id}`, "an order in progress was fully refunded; decide whether to stop work", order.id)]);
    }
  }
  await tx.orderEvent.create({
    data: { orderId: order.id, type: "REFUND_SUCCEEDED", message: `Refund of ${refund.amount} ${refund.currency} succeeded`, metadata: { refundId: refund.id, ...split } },
  });
  await enqueueOutbox(tx, [
    {
      type: "NOTIFY",
      dedupeKey: `refund-issued:${refund.id}`,
      payload: { notification: "REFUND_ISSUED", recipients: [order.userId], orderId: order.id, actorId: refund.initiatedById ?? "system" },
    },
  ]);
  return { outcome: "refund_succeeded" as const, ...split };
}

/** Admin requests a full or partial refund through Stripe. */
export async function requestRefund(
  adminId: string,
  input: { orderId: string; amount: number; reason: string; idempotencyKey: string; paymentId?: string }
) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  if (!admin || admin.role !== "ADMIN") throw new RefundError("Only administrators can issue refunds.", 403);
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3) throw new RefundError("A refund reason is required.", 400);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new RefundError("Refund amount must be a positive integer (minor units).", 400);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)) throw new RefundError("A valid Idempotency-Key is required.", 400);

  // Replays of the same admin request return the same refund.
  const existing = await prisma.refund.findUnique({ where: { idempotencyKey: `admin:${input.idempotencyKey}` } });
  if (existing) return existing;

  const refund = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, paidPaymentId: true } });
    if (!order) throw new RefundError("Order not found.", 404);
    // Default: the payment that paid the order. A specific (e.g. unapplied
    // duplicate) payment of the same order can be refunded by id.
    const paymentId = input.paymentId ?? order.paidPaymentId;
    const payment = paymentId ? await tx.payment.findUnique({ where: { id: paymentId } }) : null;
    if (payment && payment.orderId !== order.id) throw new RefundError("Payment does not belong to this order.", 400);
    if (!payment || payment.status !== "SUCCEEDED" || !payment.stripePaymentIntentId) {
      throw new RefundError("This order has no captured payment to refund.", 409);
    }
    const pending = await tx.refund.aggregate({ _sum: { amount: true }, where: { paymentId: payment.id, status: { in: ["PENDING", "SUCCEEDED"] } } });
    const lost = await tx.dispute.aggregate({ _sum: { amount: true }, where: { paymentId: payment.id, status: { in: ["OPEN", "LOST"] } } });
    const refundable = (payment.amountReceived ?? payment.amount) - (pending._sum.amount ?? 0) - (lost._sum.amount ?? 0);
    if (input.amount > refundable) throw new RefundError(`At most ${refundable} can still be refunded.`, 400);
    const created = await tx.refund.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        amount: input.amount,
        currency: payment.currency,
        reason,
        source: "ADMIN",
        idempotencyKey: `admin:${input.idempotencyKey}`,
        initiatedById: adminId,
      },
    });
    await writeAudit(tx, { actorId: adminId, action: "REFUND_REQUESTED", entityType: "refund", entityId: created.id, details: { amount: input.amount, reason } });
    return { created, paymentIntentId: payment.stripePaymentIntentId };
  });

  let stripeRefund;
  try {
    stripeRefund = await getStripe().refunds.create(
      {
        payment_intent: refund.paymentIntentId,
        amount: refund.created.amount,
        metadata: { refundId: refund.created.id, orderId: refund.created.orderId },
      },
      { idempotencyKey: `refund:${refund.created.id}` }
    );
  } catch (e) {
    await prisma.refund.update({
      where: { id: refund.created.id },
      data: { status: "FAILED", failureReason: safeErrorMessage(e) },
    });
    if (e instanceof StripeConfigError) throw new RefundError("Stripe is not configured.", 503);
    throw new RefundError("Stripe rejected the refund. See the refund record for details.", 502);
  }

  await prisma.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refund.created.id }, data: { stripeRefundId: stripeRefund.id } });
    await applyStripeRefundStatus(tx, refund.created.id, stripeRefund.status, stripeRefund.failure_reason ?? null);
  });
  await dispatchOutbox({ limit: 10 });
  return prisma.refund.findUniqueOrThrow({ where: { id: refund.created.id } });
}

/** Map a Stripe refund status onto our Refund row. */
export async function applyStripeRefundStatus(tx: Tx, refundId: string, stripeStatus: string | null | undefined, failureReason: string | null) {
  if (stripeStatus === "succeeded") return finalizeRefundSucceeded(tx, refundId);
  if (stripeStatus === "failed" || stripeStatus === "canceled") {
    const r = await tx.refund.updateMany({
      where: { id: refundId, status: "PENDING" },
      data: { status: stripeStatus === "failed" ? "FAILED" : "CANCELED", failureReason: failureReason ?? stripeStatus },
    });
    return { outcome: r.count ? `refund_${stripeStatus}` : "unchanged" };
  }
  return { outcome: "refund_pending" };
}

/**
 * Webhook reconciliation for a Stripe refund object (refund.created /
 * refund.updated / refund.failed, or each refund listed on charge.refunded).
 * Refunds created in the Stripe Dashboard are recorded with source STRIPE.
 */
export async function reconcileStripeRefund(
  tx: Tx,
  r: { id: string; amount: number; currency: string; status: string | null; payment_intent: string | null; failure_reason?: string | null; metadata?: Record<string, string> | null }
) {
  let refund = await tx.refund.findUnique({ where: { stripeRefundId: r.id } });
  if (!refund && r.metadata?.refundId) {
    const byMeta = await tx.refund.findUnique({ where: { id: r.metadata.refundId } });
    if (byMeta && !byMeta.stripeRefundId) refund = await tx.refund.update({ where: { id: byMeta.id }, data: { stripeRefundId: r.id } });
  }
  if (!refund) {
    const payment = r.payment_intent ? await tx.payment.findUnique({ where: { stripePaymentIntentId: r.payment_intent } }) : null;
    if (!payment) return { outcome: "unknown_payment" };
    if (String(r.currency).toUpperCase() !== payment.currency) return { outcome: "currency_mismatch" };
    refund = await tx.refund.create({
      data: {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: r.amount,
        currency: payment.currency,
        reason: "Created in the Stripe Dashboard",
        source: "STRIPE",
        stripeRefundId: r.id,
        idempotencyKey: `stripe:${r.id}`,
      },
    });
    await enqueueOutbox(tx, [notifyAdmins(`stripe-refund:${r.id}`, "a refund was created directly in Stripe", payment.orderId)]);
  }
  return applyStripeRefundStatus(tx, refund.id, r.status, r.failure_reason ?? null);
}
