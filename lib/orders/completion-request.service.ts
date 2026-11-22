// Server-only module.
/**
 * Completion with proof, decided by an admin (client PDFs 2026-11-22; the
 * customer confirmation and the 72 h auto-confirm are gone).
 *
 *   booster "Complete" + 1-3 end screenshots
 *     -> order AWAITING_CONFIRMATION ("waiting for review"), assignment SUBMITTED;
 *        the customer sees the screenshots on the order page, admins are told
 *          customer "Report a problem" (optional)  -> request DISPUTED (shown to the admin)
 *          admin "Complete"                        -> COMPLETED (ADMIN_ACCEPTED); the
 *                                                     booster's payout becomes AVAILABLE
 *          admin "Send back"                       -> order IN_PROGRESS, assignment IN_PROGRESS
 *
 * While waiting, the booster keeps the workspace and chat (activeOrderId is
 * kept) but has no login access (credentials need IN_PROGRESS) and the
 * order does not count toward their order limit (SUBMITTED is not active).
 * Booster earnings: allocated at completion and released at once when the
 * admin completes (single booster, no dispute, no pending refund); otherwise
 * they wait for an admin in Finance.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Prisma } from "@/app/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { transitionOrder } from "@/lib/orders/transitions";
import { enqueueOutbox, dispatchOutbox } from "@/lib/payments/outbox";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import { afterOrderCompleted, closeSessions, completeOrderInTx, verifyBoosterEligibility } from "@/lib/assignments/service";
import { proofPath, proofStore, validateProofFiles } from "@/lib/storage/order-proofs";
import { approveEarning } from "@/lib/finance/earnings";

export class CompletionFlowError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
    this.name = "CompletionFlowError";
  }
}

const OPEN = ["PENDING", "DISPUTED"] as const;
type Outcome = "CONFIRMED" | "AUTO_CONFIRMED" | "ADMIN_ACCEPTED" | "RIOT_CONFIRMED";

const OUTCOME_LABEL: Record<Outcome, string> = {
  CONFIRMED: "Confirmed by the customer",
  AUTO_CONFIRMED: "Confirmed automatically (no answer from the customer)",
  ADMIN_ACCEPTED: "Completed by an admin after review",
  RIOT_CONFIRMED: "Target confirmed by Riot",
};

/** Riot can only ever confirm; it never blocks a completion with proof. */
async function riotConfirms(orderId: string): Promise<boolean> {
  try {
    const { getRiotCapabilities } = await import("@/lib/services/games/league-of-legends/capabilities");
    if (!getRiotCapabilities().dataAccess) return false;
    const { checkCompletion } = await import("@/lib/orders/completion-check");
    return (await checkCompletion(orderId)).result === "reached";
  } catch (e) {
    logger.warn("Completion: Riot check failed", { orderId, error: e instanceof Error ? e.message : "unknown" });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Booster: submit                                                     */
/* ------------------------------------------------------------------ */

export async function submitCompletion(p: {
  orderId: string;
  assignmentId: string;
  boosterId: string;
  files: Blob[];
  note?: string | null;
  /** Tests: override the Riot check. */
  riotCheck?: (orderId: string) => Promise<boolean>;
}): Promise<{ requestId: string; status: "PENDING"; autoConfirmAt: Date }> {
  await verifyBoosterEligibility(p.boosterId);
  const note = p.note?.trim() ? p.note.trim().slice(0, 1000) : null;

  const pre = await prisma.orderBoosterAssignment.findUnique({
    where: { id: p.assignmentId },
    select: { boosterId: true, orderId: true, status: true, order: { select: { status: true } } },
  });
  if (!pre || pre.boosterId !== p.boosterId || pre.orderId !== p.orderId) throw new CompletionFlowError("Order not found.", 404);
  if (pre.order.status === "PAUSED") throw new CompletionFlowError("This order is paused by the customer and cannot be completed until it is resumed.");
  if (pre.status !== "IN_PROGRESS" || pre.order.status !== "IN_PROGRESS") throw new CompletionFlowError("This order cannot be completed right now.");

  const proofs = await validateProofFiles(p.files);
  const hours = await getConfig("auto_confirm_hours");
  const autoConfirmAt = new Date(Date.now() + hours * 3_600_000);

  // Upload first (outside the transaction); undone if the transaction fails.
  const store = proofStore();
  const uploaded: { path: string; contentType: string; size: number }[] = [];
  try {
    for (const f of proofs) {
      const path = proofPath(p.orderId, f.ext);
      await store.put(path, f.bytes, f.contentType);
      uploaded.push({ path, contentType: f.contentType, size: f.bytes.byteLength });
    }
  } catch (e) {
    await store.remove(uploaded.map((u) => u.path)).catch(() => {});
    throw e;
  }

  // Riot never completes an order on its own any more; the result is only recorded for the admin.
  const riotOk = await (p.riotCheck ?? riotConfirms)(p.orderId);

  let request: { id: string; customerId: string };
  try {
    request = await prisma.$transaction(async (tx) => {
      const moved = await tx.orderBoosterAssignment.updateMany({
        where: { id: p.assignmentId, boosterId: p.boosterId, status: "IN_PROGRESS", activeOrderId: p.orderId },
        data: { status: "SUBMITTED" },
      });
      if (moved.count !== 1) throw new CompletionFlowError("This order cannot be completed right now.");
      const order = await transitionOrder(tx, {
        where: { id: p.orderId, status: "IN_PROGRESS" },
        to: "AWAITING_CONFIRMATION",
      });
      const req = await tx.orderCompletionRequest.create({
        data: {
          orderId: p.orderId,
          assignmentId: p.assignmentId,
          boosterId: p.boosterId,
          boosterNote: note,
          autoConfirmAt,
          proofs: { create: uploaded.map((u) => ({ orderId: p.orderId, storagePath: u.path, contentType: u.contentType, sizeBytes: u.size })) },
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: p.orderId,
          type: "COMPLETION_REQUESTED",
          message: `Booster completed the order with ${uploaded.length} screenshot(s)`,
          metadata: { assignmentId: p.assignmentId, requestId: req.id, riotConfirmed: riotOk },
        },
      });
      await enqueueOutbox(tx, [
        {
          type: "NOTIFY",
          dedupeKey: `completion-submitted:${req.id}`,
          payload: { notification: "COMPLETION_SUBMITTED", recipients: [order.userId], orderId: p.orderId, actorId: p.boosterId },
        },
        {
          type: "NOTIFY",
          dedupeKey: `completion-review:${req.id}`,
          payload: { notification: "COMPLETION_REVIEW", recipients: "ADMINS", orderId: p.orderId, actorId: p.boosterId },
        },
        { type: "EMAIL_COMPLETION_SUBMITTED", dedupeKey: `completion-submitted-email:${req.id}`, payload: { requestId: req.id } },
      ]);
      return { id: req.id, customerId: order.userId };
    });
  } catch (e) {
    await store.remove(uploaded.map((u) => u.path)).catch(() => {});
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2025" || e.code === "P2002")) {
      throw new CompletionFlowError("This order cannot be completed right now.");
    }
    throw e;
  }

  // The booster stops playing: end the open play session.
  await closeSessions(p.orderId, "COMPLETED");

  await dispatchOutbox({ limit: 5 });
  await broadcastToOrder({
    orderId: p.orderId,
    event: "order.status_changed",
    payload: {
      orderId: p.orderId,
      customerId: request.customerId,
      boosterId: p.boosterId,
      previousStatus: "IN_PROGRESS",
      newStatus: "AWAITING_CONFIRMATION",
      changedAt: new Date().toISOString(),
    },
  });
  return { requestId: request.id, status: "PENDING", autoConfirmAt };
}

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Close an open request as completed and complete the order (shared write
 * with the admin "Complete"). Conditional on the request still being open:
 * a second call (double click, job + customer at once) changes nothing.
 */
export async function finalizeCompletion(requestId: string, outcome: Outcome, actorId: string, adminNote?: string | null) {
  // CONFIRMED / ADMIN_ACCEPTED also close a disputed request; the job only a pending one.
  const from = outcome === "AUTO_CONFIRMED" || outcome === "RIOT_CONFIRMED" ? (["PENDING"] as const) : OPEN;
  const result = await prisma.$transaction(async (tx) => {
    const req = await tx.orderCompletionRequest.findUnique({
      where: { id: requestId },
      select: { id: true, orderId: true, assignmentId: true, boosterId: true, order: { select: { userId: true } } },
    });
    if (!req) throw new CompletionFlowError("Completion not found.", 404);
    const closed = await tx.orderCompletionRequest.updateMany({
      where: { id: requestId, status: { in: [...from] } },
      data: { status: outcome, decidedById: actorId, decidedAt: new Date(), adminNote: adminNote?.trim() || null },
    });
    if (closed.count !== 1) throw new CompletionFlowError("This completion was already handled.");
    const { completedAt } = await completeOrderInTx(tx, {
      assignmentId: req.assignmentId,
      orderId: req.orderId,
      fromOrderStatus: "AWAITING_CONFIRMATION",
      endReason: OUTCOME_LABEL[outcome],
      metadata: { completionRequestId: requestId, outcome },
    });
    return { ...req, customerId: req.order.userId, completedAt };
  });
  await afterOrderCompleted({
    orderId: result.orderId,
    customerId: result.customerId,
    boosterId: result.boosterId,
    assignmentId: result.assignmentId,
    actorId,
    previousStatus: "AWAITING_CONFIRMATION",
    completedAt: result.completedAt,
  });
  if (outcome === "ADMIN_ACCEPTED") await releaseCompletedPayout(result.orderId, actorId);
  return { orderId: result.orderId, outcome };
}

/**
 * Admin completed the order: the booster's payout goes from Frozen to
 * Available at once (client PDF 2026-11-22). Uses the normal release, so an
 * open dispute or a pending refund still keeps it for an admin in Finance.
 */
async function releaseCompletedPayout(orderId: string, adminId: string) {
  const pending = await prisma.boosterEarning.findMany({ where: { orderId, status: "PENDING" }, select: { id: true } });
  for (const e of pending) {
    try {
      await approveEarning(adminId, e.id);
    } catch (err) {
      logger.warn("Completion: payout not released automatically", { orderId, earningId: e.id, error: err instanceof Error ? err.message : "unknown" });
    }
  }
}

async function openRequestFor(orderId: string) {
  return prisma.orderCompletionRequest.findFirst({
    where: { orderId, status: { in: [...OPEN] } },
    select: { id: true, status: true, boosterId: true, assignmentId: true, order: { select: { userId: true } } },
  });
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export async function disputeByCustomer(orderId: string, customerId: string, reason: string) {
  const text = reason.trim();
  if (text.length < 10) throw new CompletionFlowError("Tell us what is wrong (at least 10 characters).", 400);
  const req = await openRequestFor(orderId);
  if (!req || req.order.userId !== customerId) throw new CompletionFlowError("There is nothing to report on this order.", 404);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.orderCompletionRequest.updateMany({
      where: { id: req.id, status: "PENDING" },
      data: { status: "DISPUTED", disputeReason: text.slice(0, 1000), disputedAt: new Date() },
    });
    if (moved.count !== 1) throw new CompletionFlowError("A problem was already reported; our team is reviewing it.");
    await tx.orderEvent.create({
      data: { orderId, type: "COMPLETION_DISPUTED", message: "The customer reported a problem with the completion", metadata: { requestId: req.id } },
    });
    await enqueueOutbox(tx, [
      {
        type: "NOTIFY",
        dedupeKey: `completion-disputed:${req.id}`,
        payload: { notification: "COMPLETION_DISPUTED", recipients: "ADMINS", orderId, actorId: customerId },
      },
      {
        type: "NOTIFY",
        dedupeKey: `completion-disputed-booster:${req.id}`,
        payload: { notification: "COMPLETION_DISPUTED", recipients: [req.boosterId], orderId, actorId: customerId },
      },
    ]);
  });
  await dispatchOutbox({ limit: 5 });
  return { requestId: req.id };
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export async function adminAcceptCompletion(requestId: string, adminId: string, note?: string | null) {
  return finalizeCompletion(requestId, "ADMIN_ACCEPTED", adminId, note);
}

/** Back to the booster: order and assignment IN_PROGRESS again (login access returns). */
export async function adminSendBack(requestId: string, adminId: string, note: string) {
  const text = note.trim();
  if (text.length < 5) throw new CompletionFlowError("Tell the booster what is missing (at least 5 characters).", 400);
  const r = await prisma.$transaction(async (tx) => {
    const req = await tx.orderCompletionRequest.findUnique({
      where: { id: requestId },
      select: { orderId: true, assignmentId: true, boosterId: true, order: { select: { userId: true } } },
    });
    if (!req) throw new CompletionFlowError("Completion not found.", 404);
    const closed = await tx.orderCompletionRequest.updateMany({
      where: { id: requestId, status: { in: [...OPEN] } },
      data: { status: "SENT_BACK", decidedById: adminId, decidedAt: new Date(), adminNote: text.slice(0, 1000) },
    });
    if (closed.count !== 1) throw new CompletionFlowError("This completion was already handled.");
    const back = await tx.orderBoosterAssignment.updateMany({
      where: { id: req.assignmentId, status: "SUBMITTED", activeOrderId: req.orderId },
      data: { status: "IN_PROGRESS" },
    });
    if (back.count !== 1) throw new CompletionFlowError("The booster's assignment is no longer waiting.");
    await transitionOrder(tx, { where: { id: req.orderId, status: "AWAITING_CONFIRMATION" }, to: "IN_PROGRESS" });
    await tx.orderEvent.create({
      data: { orderId: req.orderId, type: "COMPLETION_SENT_BACK", message: text.slice(0, 1000), metadata: { requestId, adminId } },
    });
    await enqueueOutbox(tx, [
      {
        type: "NOTIFY",
        dedupeKey: `completion-sent-back:${requestId}`,
        payload: {
          notification: "COMPLETION_SENT_BACK",
          recipients: [req.boosterId, req.order.userId],
          orderId: req.orderId,
          actorId: adminId,
          metadata: { note: text.slice(0, 300) },
        },
      },
    ]);
    return { ...req, customerId: req.order.userId };
  });
  await dispatchOutbox({ limit: 5 });
  await broadcastToOrder({
    orderId: r.orderId,
    event: "order.status_changed",
    payload: {
      orderId: r.orderId,
      customerId: r.customerId,
      boosterId: r.boosterId,
      previousStatus: "AWAITING_CONFIRMATION",
      newStatus: "IN_PROGRESS",
      changedAt: new Date().toISOString(),
    },
  });
  return { orderId: r.orderId };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface CompletionRequestDTO {
  id: string;
  status: string;
  submittedAt: string;
  autoConfirmAt: string;
  boosterNote: string | null;
  disputeReason: string | null;
  disputedAt: string | null;
  adminNote: string | null;
  decidedAt: string | null;
  proofs: { id: string; url: string }[];
}

export function proofUrl(orderId: string, proofId: string) {
  return `/api/orders/${orderId}/proofs/${proofId}`;
}

/** The latest completion request of an order (open or last decided). */
export async function latestCompletionRequest(orderId: string): Promise<CompletionRequestDTO | null> {
  const r = await prisma.orderCompletionRequest.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    include: { proofs: { select: { id: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    submittedAt: r.createdAt.toISOString(),
    autoConfirmAt: r.autoConfirmAt.toISOString(),
    boosterNote: r.boosterNote,
    disputeReason: r.disputeReason,
    disputedAt: r.disputedAt?.toISOString() ?? null,
    adminNote: r.adminNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    proofs: r.proofs.map((p) => ({ id: p.id, url: proofUrl(orderId, p.id) })),
  };
}
