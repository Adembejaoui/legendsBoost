// Server-only module.
/**
 * Customer cancellation REQUESTS (decision D1: admin-reviewed).
 *
 * Customers still cannot cancel on their own (pause is the default). They
 * can ask, with a reason; an admin approves (order cancelled + refund of the
 * amount the admin sets, pro-rata to progress) or rejects with a note. This
 * gives EU customers a withdrawal path without self-serve refunds.
 *
 * Approval order: cancel first (work stops, booster loses access), then
 * refund through the normal refund path (Stripe + ledger). If Stripe fails,
 * the request stays APPROVED without refundId and the admin retries from the
 * order's refund tool.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cancelAssignment } from "@/lib/assignments/service";
import { requestRefund } from "@/lib/finance/refunds";
import { enqueueOutbox, notifyAdmins, dispatchOutbox } from "@/lib/payments/outbox";
import { transitionOrder } from "./transitions";
import { logger } from "@/lib/logger";

export class CancellationRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CancellationRequestError";
  }
}

/** Order statuses in which a customer may ask to cancel (paid, not finished). */
export const CANCEL_REQUESTABLE_STATUSES = ["PENDING", "CLAIMED", "IN_PROGRESS", "PAUSED", "DRAFT"] as const;

export const cancellationReasonSchema = z
  .string()
  .trim()
  .min(10, "Please explain why (10 characters minimum).")
  .max(1000, "Please keep it under 1000 characters.");

export function canRequestCancellation(order: { status: string; paymentVerifiedAt: Date | null }, hasOpenRequest: boolean) {
  return (
    !!order.paymentVerifiedAt &&
    (CANCEL_REQUESTABLE_STATUSES as readonly string[]).includes(order.status) &&
    !hasOpenRequest
  );
}

export async function requestCancellation(customerId: string, orderId: string, rawReason: unknown) {
  const parsed = cancellationReasonSchema.safeParse(rawReason);
  if (!parsed.success) throw new CancellationRequestError(parsed.error.issues[0]?.message ?? "Invalid reason", 400);
  const reason = parsed.data;

  try {
    const request = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { userId: true, status: true, paymentVerifiedAt: true } });
      if (!order || order.userId !== customerId) throw new CancellationRequestError("Order not found", 404);
      const open = await tx.orderCancellationRequest.count({ where: { orderId, status: "REQUESTED" } });
      if (!canRequestCancellation(order, open > 0)) {
        throw new CancellationRequestError(
          open > 0 ? "A cancellation request is already being reviewed." : "This order can no longer be cancelled.",
          409
        );
      }
      const created = await tx.orderCancellationRequest.create({ data: { orderId, customerId, reason } });
      await tx.orderEvent.create({
        data: { orderId, type: "CANCELLATION_REQUESTED", message: "Customer requested cancellation", metadata: { requestId: created.id } },
      });
      await enqueueOutbox(tx, [notifyAdmins(`cancel-request:${created.id}`, "a customer asked to cancel an order", orderId, customerId)]);
      return created;
    });
    await dispatchOutbox({ limit: 5 });
    return request;
  } catch (e) {
    // Partial unique index: a concurrent second request.
    if ((e as { code?: string }).code === "P2002") throw new CancellationRequestError("A cancellation request is already being reviewed.", 409);
    throw e;
  }
}

export async function withdrawCancellation(customerId: string, orderId: string) {
  const r = await prisma.orderCancellationRequest.updateMany({
    where: { orderId, customerId, status: "REQUESTED" },
    data: { status: "WITHDRAWN" },
  });
  if (r.count === 0) throw new CancellationRequestError("There is no open cancellation request.", 404);
  await prisma.orderEvent.create({ data: { orderId, type: "CANCELLATION_WITHDRAWN", message: "Customer withdrew the cancellation request" } });
  return { withdrawn: true };
}

export const decisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("approve"),
      /** Minor units; 0 = cancel without refund. */
      refundAmount: z.number().int().min(0),
      note: z.string().trim().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      note: z.string().trim().min(3, "Tell the customer why.").max(1000),
    })
    .strict(),
]);

export async function decideCancellation(adminId: string, requestId: string, raw: unknown) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  if (admin?.role !== "ADMIN") throw new CancellationRequestError("Forbidden", 403);
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new CancellationRequestError(parsed.error.issues[0]?.message ?? "Invalid decision", 400);
  const d = parsed.data;

  const req = await prisma.orderCancellationRequest.findUnique({
    where: { id: requestId },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          paymentVerifiedAt: true,
          pricingSnapshot: { select: { totalAmount: true, currency: true } },
          assignments: { where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"] } }, select: { id: true } },
        },
      },
    },
  });
  if (!req) throw new CancellationRequestError("Request not found", 404);
  if (req.status !== "REQUESTED") throw new CancellationRequestError("This request was already decided.", 409);

  if (d.decision === "reject") {
    const r = await prisma.$transaction(async (tx) => {
      const u = await tx.orderCancellationRequest.updateMany({
        where: { id: requestId, status: "REQUESTED" },
        data: { status: "REJECTED", adminNote: d.note, decidedById: adminId, decidedAt: new Date() },
      });
      if (u.count === 0) throw new CancellationRequestError("This request was already decided.", 409);
      await tx.orderEvent.create({ data: { orderId: req.orderId, type: "CANCELLATION_REJECTED", message: d.note, metadata: { requestId } } });
      await audit({ actorId: adminId, action: "CANCELLATION_REJECTED", entityType: "order", entityId: req.orderId, metadata: { requestId } }, tx);
      return u;
    });
    return { status: "REJECTED" as const, updated: r.count };
  }

  const total = req.order.pricingSnapshot?.totalAmount ?? 0;
  if (d.refundAmount > total) throw new CancellationRequestError("The refund cannot be more than the amount paid.", 400);

  // Claim the request first so two admins cannot both approve.
  const claimed = await prisma.orderCancellationRequest.updateMany({
    where: { id: requestId, status: "REQUESTED" },
    data: { status: "APPROVED", adminNote: d.note ?? null, decidedById: adminId, decidedAt: new Date(), refundAmount: d.refundAmount },
  });
  if (claimed.count === 0) throw new CancellationRequestError("This request was already decided.", 409);

  // 1. Stop the work and cancel the order.
  const reason = `Cancelled at the customer's request${d.note ? `: ${d.note}` : ""}`;
  const active = req.order.assignments[0];
  if (active) {
    await cancelAssignment(active.id, adminId, "ADMIN", reason);
  } else if (req.order.status !== "CANCELLED") {
    await prisma.$transaction(async (tx) => {
      await transitionOrder(tx, { where: { id: req.orderId, status: { in: ["PENDING", "DRAFT", "PAUSED", "IN_PROGRESS", "CLAIMED"] } }, to: "CANCELLED" });
      await tx.orderEvent.create({ data: { orderId: req.orderId, type: "ORDER_CANCELLED", message: reason, metadata: { requestId } } });
    });
  }
  await audit({ actorId: adminId, action: "CANCELLATION_APPROVED", entityType: "order", entityId: req.orderId, metadata: { requestId, refundAmount: d.refundAmount } });

  // 2. Refund (Stripe + ledger) through the normal path.
  let refundId: string | null = null;
  let refundError: string | null = null;
  if (d.refundAmount > 0) {
    try {
      const refund = await requestRefund(adminId, {
        orderId: req.orderId,
        amount: d.refundAmount,
        reason: "Customer cancellation request approved",
        idempotencyKey: `cancelreq_${requestId}`,
      });
      refundId = refund.id;
      await prisma.orderCancellationRequest.update({ where: { id: requestId }, data: { refundId } });
    } catch (e) {
      refundError = e instanceof Error ? e.message : "Refund failed";
      logger.error("Refund after approved cancellation failed", { requestId, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  return { status: "APPROVED" as const, refundId, refundError };
}
