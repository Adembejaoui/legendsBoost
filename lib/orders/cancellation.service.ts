/**
 * Customer cancellation of unpaid orders.
 *
 *   AWAITING_PAYMENT --(owner cancels)--> CANCELLED
 *   PENDING (no verified payment, no active booster) --(owner cancels)--> CANCELLED
 *
 * Everything else is refused (409) with a reason:
 *   - an order with a verified payment needs the refund flow (not built yet);
 *   - IN_PROGRESS / PAUSED: a booster is working on it, so support decides;
 *   - DRAFT: under admin review; only an admin may cancel (with a reason);
 *   - COMPLETED / CANCELLED: final.
 *
 * Enforcement is server-side: the role is re-read from the database, the
 * order must belong to the caller (404 otherwise, so ids cannot be probed),
 * and the write is a conditional update that also requires "still unpaid",
 * so a concurrent payment confirmation can never be overwritten by a cancel.
 */
import prisma from "@/lib/prisma";
import { releaseCashbackForOrder } from "@/lib/cashback/service";
import { Prisma } from "@/app/generated/prisma/client";
import { createNotificationsForEvent } from "@/lib/notifications/service";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/assignments/types";
import { hasVerifiedPayment } from "@/lib/orders/payment-gate";
import { dispatchOutbox, enqueueOutbox } from "@/lib/payments/outbox";
import { transitionOrder } from "./transitions";

export const CANCEL_REASON_MAX_LENGTH = 500;

export const CUSTOMER_CANCELLABLE_STATUSES = ["AWAITING_PAYMENT", "PENDING"] as const;

export class OrderCancellationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "OrderCancellationError";
  }
}

export type CancelEligibility = { ok: true } | { ok: false; reason: string };

/** Pure rule: can the owning customer cancel this order right now? */
export function getCustomerCancelEligibility(order: {
  status: string;
  paymentVerifiedAt?: Date | string | null;
  assignments?: { status: string }[];
}): CancelEligibility {
  switch (order.status) {
    case "CANCELLED":
      return { ok: false, reason: "This order is already cancelled." };
    case "COMPLETED":
      return { ok: false, reason: "Completed orders cannot be cancelled." };
    case "CLAIMED":
    case "IN_PROGRESS":
    case "PAUSED":
      return { ok: false, reason: "A booster is working on this order. Contact support to cancel it." };
    case "DRAFT":
      return { ok: false, reason: "This order is being reviewed by our team. Contact support to cancel it." };
  }
  if (!(CUSTOMER_CANCELLABLE_STATUSES as readonly string[]).includes(order.status)) {
    return { ok: false, reason: "This order cannot be cancelled." };
  }
  if (hasVerifiedPayment(order)) {
    return { ok: false, reason: "This order has been paid. Contact support to cancel it and request a refund." };
  }
  const active = (order.assignments ?? []).some((a) =>
    (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(a.status)
  );
  if (active) {
    return { ok: false, reason: "A booster is assigned to this order. Contact support to cancel it." };
  }
  return { ok: true };
}

export async function cancelOrderByCustomer(orderId: string, userId: string, reason?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role ?? "CUSTOMER") !== "CUSTOMER") {
    throw new OrderCancellationError("Only the customer who placed the order can cancel it.", 403);
  }
  const cleanReason = reason?.trim().slice(0, CANCEL_REASON_MAX_LENGTH) || null;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        assignments: {
          where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          select: { status: true },
        },
      },
    });
    // Not found and not yours look the same.
    if (!order || order.userId !== userId) throw new OrderCancellationError("Order not found", 404);

    const eligibility = getCustomerCancelEligibility(order);
    if (!eligibility.ok) throw new OrderCancellationError(eligibility.reason, 409);

    // A delayed payment (e.g. bank debit) may still succeed: never cancel
    // under it. An open checkout is closed so it can no longer be paid.
    const open = await tx.payment.findUnique({ where: { openSlotOrderId: orderId } });
    if (open?.status === "PROCESSING") {
      throw new OrderCancellationError("A payment for this order is being processed. Contact support to cancel it.", 409);
    }
    if (open) {
      await tx.payment.update({ where: { id: open.id, openSlotOrderId: orderId }, data: { status: "CANCELED", openSlotOrderId: null } });
      if (open.stripeCheckoutSessionId) {
        await enqueueOutbox(tx, [
          { type: "EXPIRE_CHECKOUT_SESSION", dedupeKey: `expire:${open.stripeCheckoutSessionId}`, payload: { sessionId: open.stripeCheckoutSessionId } },
        ]);
      }
    }

    try {
      await transitionOrder(tx, {
        where: {
          id: orderId,
          userId,
          status: { in: [...CUSTOMER_CANCELLABLE_STATUSES] },
          paymentVerifiedAt: null,
        },
        to: "CANCELLED",
      });
      // Cashback reserved for this unpaid order comes back.
      await releaseCashbackForOrder(tx, orderId);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2025") {
        throw new OrderCancellationError("This order changed in the meantime. Refresh and try again.", 409);
      }
      throw error;
    }

    const event = await tx.orderEvent.create({
      data: {
        orderId,
        type: "ORDER_CANCELLED",
        message: cleanReason ?? "Cancelled by the customer",
        metadata: {
          actorUserId: userId,
          cancelledBy: "CUSTOMER",
          previousStatus: order.status,
          reason: cleanReason,
        } as Prisma.InputJsonValue,
      },
    });
    return { previousStatus: order.status, eventId: event.id, customerId: order.userId };
  });

  await dispatchOutbox({ limit: 5 });
  await createNotificationsForEvent({
    type: "ORDER_CANCELLED",
    orderId,
    actorId: userId,
    dedupeKey: `ORDER_CANCELLED:${orderId}`,
  });
  await broadcastToOrder({
    orderId,
    event: "order.status_changed",
    payload: {
      orderId,
      customerId: result.customerId,
      boosterId: null,
      previousStatus: result.previousStatus,
      newStatus: "CANCELLED",
      changedAt: new Date().toISOString(),
    },
  });

  return { id: orderId, status: "CANCELLED" as const, previousStatus: result.previousStatus };
}
