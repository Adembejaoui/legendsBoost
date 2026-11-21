// Server-only module.
/**
 * Customer "Change booster" requests (client PDF 2026-11-21, decision: an
 * admin reviews every request).
 *
 * The customer asks with a reason while a booster holds the order; the
 * booster keeps working until an admin decides:
 *  - approve: the assignment is released through the normal admin path
 *    (`releaseAssignment`), the order goes back to the marketplace and the
 *    replaced booster can never take it again (pool rule "already worked on
 *    this order");
 *  - reject: a note for the customer, nothing else changes.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { releaseAssignment } from "@/lib/assignments/service";
import { enqueueOutbox, notifyAdmins, dispatchOutbox } from "@/lib/payments/outbox";

export class BoosterChangeError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BoosterChangeError";
  }
}

/** Assignment statuses in which a booster holds the order. */
export const HELD_ASSIGNMENT_STATUSES = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"] as const;

export const boosterChangeReasonSchema = z
  .string()
  .trim()
  .min(10, "Please explain why (10 characters minimum).")
  .max(1000, "Please keep it under 1000 characters.");

export async function requestBoosterChange(customerId: string, orderId: string, rawReason: unknown) {
  const parsed = boosterChangeReasonSchema.safeParse(rawReason);
  if (!parsed.success) throw new BoosterChangeError(parsed.error.issues[0]?.message ?? "Invalid reason", 400);
  const reason = parsed.data;

  try {
    const request = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          userId: true,
          paymentVerifiedAt: true,
          assignments: { where: { status: { in: [...HELD_ASSIGNMENT_STATUSES] } }, select: { id: true, boosterId: true }, take: 1 },
        },
      });
      if (!order || order.userId !== customerId) throw new BoosterChangeError("Order not found", 404);
      const held = order.assignments[0];
      if (!order.paymentVerifiedAt || !held) throw new BoosterChangeError("There is no booster to change on this order.", 409);
      const open = await tx.orderBoosterChangeRequest.count({ where: { orderId, status: "REQUESTED" } });
      if (open > 0) throw new BoosterChangeError("A booster change request is already being reviewed.", 409);
      const created = await tx.orderBoosterChangeRequest.create({
        data: { orderId, customerId, assignmentId: held.id, boosterId: held.boosterId, reason },
      });
      await tx.orderEvent.create({
        data: { orderId, type: "BOOSTER_CHANGE_REQUESTED", message: "Customer asked for a different booster", metadata: { requestId: created.id } },
      });
      await enqueueOutbox(tx, [notifyAdmins(`booster-change:${created.id}`, "a customer asked for a different booster", orderId, customerId)]);
      return created;
    });
    await dispatchOutbox({ limit: 5 });
    return request;
  } catch (e) {
    // Partial unique index: a concurrent second request.
    if ((e as { code?: string }).code === "P2002") throw new BoosterChangeError("A booster change request is already being reviewed.", 409);
    throw e;
  }
}

export async function withdrawBoosterChange(customerId: string, orderId: string) {
  const r = await prisma.orderBoosterChangeRequest.updateMany({
    where: { orderId, customerId, status: "REQUESTED" },
    data: { status: "WITHDRAWN" },
  });
  if (r.count === 0) throw new BoosterChangeError("There is no open booster change request.", 404);
  await prisma.orderEvent.create({ data: { orderId, type: "BOOSTER_CHANGE_WITHDRAWN", message: "Customer withdrew the booster change request" } });
  return { withdrawn: true };
}

export const boosterChangeDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), note: z.string().trim().max(1000).optional() }).strict(),
  z.object({ decision: z.literal("reject"), note: z.string().trim().min(3, "Tell the customer why.").max(1000) }).strict(),
]);

export async function decideBoosterChange(adminId: string, requestId: string, raw: unknown) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  if (admin?.role !== "ADMIN") throw new BoosterChangeError("Forbidden", 403);
  const parsed = boosterChangeDecisionSchema.safeParse(raw);
  if (!parsed.success) throw new BoosterChangeError(parsed.error.issues[0]?.message ?? "Invalid decision", 400);
  const d = parsed.data;

  const req = await prisma.orderBoosterChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new BoosterChangeError("Request not found", 404);
  if (req.status !== "REQUESTED") throw new BoosterChangeError("This request was already decided.", 409);

  // Claim the request first so two admins cannot both decide.
  const claimed = await prisma.orderBoosterChangeRequest.updateMany({
    where: { id: requestId, status: "REQUESTED" },
    data: { status: d.decision === "approve" ? "APPROVED" : "REJECTED", adminNote: d.note ?? null, decidedById: adminId, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new BoosterChangeError("This request was already decided.", 409);

  if (d.decision === "reject") {
    await prisma.orderEvent.create({ data: { orderId: req.orderId, type: "BOOSTER_CHANGE_REJECTED", message: d.note, metadata: { requestId } } });
    await audit({ actorId: adminId, action: "BOOSTER_CHANGE_REJECTED", entityType: "order", entityId: req.orderId, metadata: { requestId } });
    return { status: "REJECTED" as const };
  }

  // Release the booster who held the order when the customer asked (if they
  // still hold it): the order goes back to the marketplace.
  const held = await prisma.orderBoosterAssignment.findFirst({
    where: { id: req.assignmentId, status: { in: [...HELD_ASSIGNMENT_STATUSES] } },
    select: { id: true },
  });
  if (held) {
    await releaseAssignment(held.id, adminId, "ADMIN", `Booster changed at the customer's request${d.note ? `: ${d.note}` : ""}`);
  }
  await prisma.orderEvent.create({
    data: { orderId: req.orderId, type: "BOOSTER_CHANGE_APPROVED", message: d.note ?? "Booster change approved", metadata: { requestId, released: !!held } },
  });
  await audit({ actorId: adminId, action: "BOOSTER_CHANGE_APPROVED", entityType: "order", entityId: req.orderId, metadata: { requestId, released: !!held } });
  return { status: "APPROVED" as const, released: !!held };
}
