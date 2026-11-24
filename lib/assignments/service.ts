/**
 * Assignment service - handles all booster assignment operations with
 * transactions, concurrency control, and business logic.
 *
 * Order lifecycle:
 *   PENDING --(bid won / claim now / priority / preferred, lib/pool)--> CLAIMED
 *   CLAIMED --(booster starts)--> IN_PROGRESS
 *   IN_PROGRESS --(customer pauses)--> PAUSED --(customer resumes)--> IN_PROGRESS
 *   IN_PROGRESS --(booster completes)--> COMPLETED
 *   IN_PROGRESS --(booster abandons)--> DRAFT (admin review)
 *   IN_PROGRESS/PAUSED --(admin cancels / releases / reassigns)--> ...
 *
 * Boosters have exactly three actions: claim, complete, abandon. A paused
 * order blocks complete and abandon.
 *
 * Claiming an order moves it straight to IN_PROGRESS: there is no separate
 * accept/start step. Paused assignments stay active (activeOrderId is kept)
 * so a paused order is never shown as available to another booster.
 *
 * Payment gate: an order is listed/claimable only when it is PENDING *and*
 * has a verified payment (Order.paymentVerifiedAt, see
 * lib/orders/payment-gate.ts). Boosters cannot cancel orders; they abandon.
 */
import prisma from "@/lib/prisma";
import { earnCashbackOnCompletion } from "@/lib/cashback/service";
import { logger } from "@/lib/logger";
import { getConfigIn } from "@/lib/config";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  type ActiveAssignmentStatus,
  AssignmentStatus,
  BoosterCancellationForbiddenError,
  BoosterNotEligibleError,
  canOrderTransition,
  canTransition,
  NotBoosterOwnerError,
  NotOrderOwnerError,
  OrderAlreadyClaimedError,
  OrderStateConflictError,
  OrderNotClaimableError,
  OrderNotFoundError,
  validateAssignmentTransition,
  validateOrderTransition,
} from "./types";
import { Prisma } from "@/app/generated/prisma/client";
import { createNotificationsForEvent } from "@/lib/notifications/service";
import { revokeOrderAccess, broadcastToOrder } from "@/lib/realtime/broadcast";
import { hasVerifiedPayment, VERIFIED_PAYMENT_WHERE } from "@/lib/orders/payment-gate";
import { allocateOnCompletion } from "@/lib/finance/earnings";
import { dispatchOutbox, enqueueOutbox } from "@/lib/payments/outbox";
import { transitionOrder } from "@/lib/orders/transitions";
import { canClaimNewOrders, hasBoosterAccess } from "@/lib/boosters/status";

/**
 * purpose "work": access existing orders (APPROVED, TRIAL, ON_BREAK).
 * purpose "claim": take a NEW order (APPROVED, or TRIAL with trial orders
 * left); see lib/boosters/status.ts.
 */
/** Live: the order pool changed (best effort, after commit). */
async function livePool(reason: "added" | "removed") {
  const { signalPool } = await import("@/lib/realtime/live");
  await signalPool(reason);
}

/**
 * If the leaving booster ever viewed the customer's login, record that the
 * customer should change their password. Best effort.
 */
async function adviseLoginChange(orderId: string, boosterId: string) {
  try {
    const viewed = await prisma.orderCredentialReveal.count({ where: { orderId, boosterId } });
    if (viewed > 0) {
      await prisma.orderEvent.create({
        data: { orderId, type: "PASSWORD_CHANGE_ADVISED", message: "The previous booster viewed the login: the customer should change the password", metadata: { boosterId } },
      });
    }
  } catch (e) {
    logger.warn("Login change advice failed", { orderId, error: e instanceof Error ? e.message : "unknown" });
  }
}

/**
 * Close the order's open play sessions after a pause / completion / release
 * committed. Best effort: access never depends on it (a session only counts
 * while the order is IN_PROGRESS and held by the session's assignment).
 */
export async function closeSessions(orderId: string, reason: "PAUSED" | "COMPLETED" | "RELEASED" | "CANCELLED") {
  try {
    const { endOpenSessions } = await import("@/lib/orders/sessions.service");
    await endOpenSessions(prisma, orderId, reason);
  } catch (e) {
    logger.warn("Closing sessions failed", { orderId, error: e instanceof Error ? e.message : "unknown" });
  }
}

export async function verifyBoosterEligibility(userId: string, purpose: "work" | "claim" = "work") {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { boosterProfile: true },
  });

  if (!user) {
    throw new BoosterNotEligibleError("User not found");
  }

  if (user.role !== "BOOSTER") {
    throw new BoosterNotEligibleError("User is not a booster");
  }

  if (!user.boosterProfile) {
    throw new BoosterNotEligibleError("Booster profile not found");
  }

  const status = user.boosterProfile.verificationStatus;
  if (!hasBoosterAccess(status)) {
    throw new BoosterNotEligibleError(
      "Booster is not approved. Pending, rejected or suspended boosters cannot claim orders."
    );
  }
  if (purpose === "claim" && user.boosterProfile.claimBlockedAt) {
    throw new BoosterNotEligibleError("You cannot take new orders until our team reviews your account (orders taken back for inactivity).");
  }
  if (purpose === "claim" && !canClaimNewOrders(status, user.boosterProfile.trialOrdersRemaining)) {
    throw new BoosterNotEligibleError(
      status === "ON_BREAK"
        ? "You are on a break. End your break to take new orders."
        : "Your trial orders are used up. An admin will review your trial before you can take more."
    );
  }

  return { user, boosterProfile: user.boosterProfile };
}

export function isOrderClaimable(order: {
  status: string;
  assignments?: unknown[];
  paymentVerifiedAt?: Date | string | null;
}): boolean {
  if (order.status !== "PENDING") {
    return false;
  }
  // PENDING alone never means paid: a verified payment is required.
  if (!hasVerifiedPayment(order)) {
    return false;
  }
  if (order.assignments && order.assignments.length > 0) {
    const hasActive = (order.assignments as unknown[]).some((a: unknown) => {
      const status = (a as { status?: string }).status;
      return typeof status === "string" && ACTIVE_ASSIGNMENT_STATUSES.includes(status as ActiveAssignmentStatus);
    });
    if (hasActive) return false;
  }
  return true;
}

export async function getAvailableOrders(filters?: {
  gameSlug?: string;
}) {
  const where: any = {
    status: "PENDING",
    // Explicitly exclude unpaid orders (paymentVerifiedAt IS NULL).
    ...VERIFIED_PAYMENT_WHERE,
    assignments: {
      none: {
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      },
    },
  };

  if (filters?.gameSlug && filters.gameSlug !== "all") {
    where.gameSlug = filters.gameSlug;
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      assignments: {
        where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      },
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return orders.filter((order) => isOrderClaimable(order));
}

/** Assignments that ended with the order taken away from the booster. */
const ENDED_WITHOUT_BOOSTER = ["RELEASED", "DECLINED"] as const;

export async function getBoosterAssignments(
  boosterId: string,
  filter?: "active" | "all" | "history"
) {
  // Booster order list test 2026-11-22: once an assignment ends without the
  // booster finishing it (customer changed booster, booster abandoned, or
  // declined), the order leaves that booster's lists at once. The admin still
  // sees it, and the order page is already closed to that booster.
  const where: any = {
    boosterId,
    status: { notIn: [...ENDED_WITHOUT_BOOSTER] },
  };

  if (filter === "active") {
    where.status = { in: [...ACTIVE_ASSIGNMENT_STATUSES] };
  } else if (filter === "history") {
    where.status = { in: ["COMPLETED", "CANCELLED"] };
  }

  // Only what the booster pages show: plain values (no Decimal), and never
  // the customer price or any customer detail.
  const assignments = await prisma.orderBoosterAssignment.findMany({
    where,
    include: {
      order: {
        select: { id: true, gameSlug: true, serviceSlug: true, configuration: true, selectedMode: true, status: true, createdAt: true },
      },
    },
    orderBy: {
      assignedAt: "desc",
    },
  });

  return assignments;
}

type OrderAndAssignment = {
  order: { id: string; status: string; userId: string };
  assignment: { id: string; status: string; activeOrderId: string | null };
};

async function loadAssignmentAndOrder(
  tx: Prisma.TransactionClient,
  assignmentId: string
): Promise<{
  assignment: any;
  order: { id: string; status: string; userId: string; paymentVerifiedAt: Date | null };
} | null> {
  const assignment = await tx.orderBoosterAssignment.findUnique({
    where: { id: assignmentId },
    include: { order: true },
  });
  if (!assignment) return null;
  return { assignment, order: assignment.order };
}

function assertAssignmentAccess(
  assignment: { boosterId: string; orderId: string },
  userId: string,
  userRole: string | null | undefined,
  orderId?: string
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin && assignment.boosterId !== userId) {
    throw new NotBoosterOwnerError();
  }
  if (orderId && assignment.orderId !== orderId) {
    throw new NotBoosterOwnerError();
  }
}

/**
 * Take an order now (claim now / priority / preferred booster): see
 * lib/pool/service.ts `claimNow`. The order becomes CLAIMED and the
 * assignment ASSIGNED; the booster then starts it with `startAssignment`.
 */
export async function claimOrder(orderId: string, boosterId: string) {
  await verifyBoosterEligibility(boosterId, "claim");
  const { claimNow } = await import("@/lib/pool/service");
  const result = await claimNow(boosterId, orderId);
  return { assignment: result.assignment, order: result.order };
}

/**
 * The assigned booster starts a CLAIMED order: order -> IN_PROGRESS,
 * assignment ASSIGNED -> IN_PROGRESS (startedAt). Conditional on both rows;
 * a repeat (double click) is a no-op.
 */
export async function startAssignment(orderId: string, boosterId: string) {
  await verifyBoosterEligibility(boosterId, "work");
  const result = await prisma.$transaction(async (tx) => {
    const assignment = await tx.orderBoosterAssignment.findFirst({
      where: { orderId, boosterId, activeOrderId: orderId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
    });
    if (!assignment) throw new NotBoosterOwnerError();
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, userId: true, status: true } });
    if (!order) throw new OrderNotFoundError(orderId);
    if (assignment.status === "IN_PROGRESS" && order.status === "IN_PROGRESS") return { changed: false as const, order, assignment };
    if (assignment.status !== "ASSIGNED" || order.status !== "CLAIMED") {
      throw new OrderStateConflictError(`order is ${order.status}; only a claimed order can be started`);
    }
    const now = new Date();
    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignment.id, status: "ASSIGNED" },
      data: { status: "IN_PROGRESS", startedAt: now, acceptedAt: assignment.acceptedAt ?? now },
    });
    const updatedOrder = await transitionOrder(tx, { where: { id: orderId, status: "CLAIMED" }, to: "IN_PROGRESS" });
    await tx.orderEvent.create({
      data: { orderId, type: "WORK_STARTED", message: "Work started", metadata: { assignmentId: assignment.id, boosterId } },
    });
    return { changed: true as const, order: updatedOrder, assignment: updated };
  });
  if (result.changed) {
    await createNotificationsForEvent({ type: "ORDER_STARTED", orderId, assignmentId: result.assignment.id, actorId: boosterId });
    await broadcastToOrder({
      orderId,
      event: "order.started",
      payload: {
        orderId,
        customerId: result.order.userId,
        boosterId,
        assignmentId: result.assignment.id,
        startedAt: result.assignment.startedAt?.toISOString() ?? new Date().toISOString(),
      },
    });
  }
  return result;
}

/**
 * Customer pause / resume.
 *
 * Only the customer who owns the order may pause or resume it; boosters and
 * admins cannot. The assignment stays active and keeps activeOrderId, so the
 * order stays with its booster and is never listed as available. Nothing
 * financial is touched (no refund, no ledger entry, no earning change), and
 * rank progress / match history are preserved: the ORDER_PAUSED /
 * ORDER_RESUMED events written here are what match attribution uses to
 * exclude paused time (see buildWorkWindows).
 *
 * Concurrency: the order and the assignment are updated with conditional
 * writes inside one transaction. If another request changed either row
 * first, the transaction rolls back with OrderStateConflictError. A repeat of
 * a request that already succeeded (double click, retry) is a no-op that
 * reports `changed: false` and sends nothing.
 */
export type CustomerOrderControl = "pause" | "resume";

const CUSTOMER_CONTROL = {
  pause: {
    from: "IN_PROGRESS",
    to: "PAUSED",
    event: "ORDER_PAUSED",
    message: "Order paused by the customer",
    notification: "ORDER_PAUSED_BY_CUSTOMER",
  },
  resume: {
    from: "PAUSED",
    to: "IN_PROGRESS",
    event: "ORDER_RESUMED",
    message: "Order resumed by the customer",
    notification: "ORDER_RESUMED_BY_CUSTOMER",
  },
} as const;

const CONCURRENT_CHANGE = "The order changed while you were updating it. Refresh and try again.";

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

type ControlTxResult =
  | { changed: false }
  | { changed: true; assignmentId: string; boosterId: string; eventId: string; at: Date };

export async function setCustomerOrderPaused(
  orderId: string,
  customerId: string,
  action: CustomerOrderControl
): Promise<{ changed: boolean; status: "PAUSED" | "IN_PROGRESS" }> {
  const c = CUSTOMER_CONTROL[action];

  let result: ControlTxResult;
  try {
    result = await prisma.$transaction(async (tx): Promise<ControlTxResult> => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true, status: true },
      });
      // Same answer for "missing" and "not yours": never disclose other orders.
      if (!order || order.userId !== customerId) throw new NotOrderOwnerError();

      if (order.status === c.to) return { changed: false };
      if (order.status !== c.from) {
        throw new OrderStateConflictError(
          action === "pause"
            ? "Only an order that is in progress can be paused."
            : "Only a paused order can be resumed."
        );
      }

      const assignment = await tx.orderBoosterAssignment.findFirst({
        where: { orderId, activeOrderId: orderId, status: c.from },
        select: { id: true, boosterId: true },
      });
      if (!assignment) {
        throw new OrderStateConflictError("This order has no booster working on it.");
      }

      // Conditional writes: a concurrent change makes one of them match
      // nothing, which rolls the whole transaction back.
      const updated = await tx.orderBoosterAssignment.updateMany({
        where: { id: assignment.id, status: c.from, activeOrderId: orderId },
        data: { status: c.to },
      });
      if (updated.count !== 1) throw new OrderStateConflictError(CONCURRENT_CHANGE);
      await transitionOrder(tx, {
        where: { id: orderId, userId: customerId, status: c.from },
        to: c.to,
      });

      const at = new Date();
      // Operational history (not a financial record). Also the pause-window
      // source for match attribution.
      const event = await tx.orderEvent.create({
        data: {
          orderId,
          type: c.event,
          message: c.message,
          metadata: { assignmentId: assignment.id, actorUserId: customerId, actorRole: "CUSTOMER" },
          createdAt: at,
        },
      });
      // Sound test 2026-11-22: the booster is also emailed when the order is paused.
      if (action === "pause") {
        await enqueueOutbox(tx, [
          { type: "EMAIL_ORDER_PAUSED", dedupeKey: `order-paused:${event.id}`, payload: { orderId, boosterId: assignment.boosterId } },
        ]);
      }
      return { changed: true, assignmentId: assignment.id, boosterId: assignment.boosterId, eventId: event.id, at };
    });
  } catch (error) {
    if (isPrismaCode(error, "P2025")) throw new OrderStateConflictError(CONCURRENT_CHANGE);
    throw error;
  }

  if (!result.changed) return { changed: false, status: c.to };

  // Tell the booster immediately: persistent notification (+ user-channel
  // broadcast) and an order-channel status change that open workspaces use
  // to refresh. Failures here never undo the committed state change.
  try {
    await createNotificationsForEvent({
      type: c.notification,
      orderId,
      assignmentId: result.assignmentId,
      actorId: customerId,
      dedupeKey: `${c.event}:${result.eventId}`,
    });
  } catch (e) {
    console.error(`[orders] ${c.event} notification failed`, {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  await broadcastToOrder({
    orderId,
    event: "order.status_changed",
    payload: {
      orderId,
      customerId,
      boosterId: result.boosterId,
      previousStatus: c.from,
      newStatus: c.to,
      changedAt: result.at.toISOString(),
    },
  });

  if (c.to === "PAUSED") {
    await closeSessions(orderId, "PAUSED");
    await dispatchOutbox({ limit: 5 }).catch(() => {});
  }
  return { changed: true, status: c.to };
}

export async function completeAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin) {
    await verifyBoosterEligibility(userId);
    const { assertBoosterCompletionConfirmed } = await import("@/lib/orders/completion-check");
    await assertBoosterCompletionConfirmed(assignmentId, userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

    if (order.status === "PAUSED" || assignment.status === "PAUSED") {
      throw new OrderStateConflictError(
        "This order is paused by the customer and cannot be completed until it is resumed."
      );
    }
    if (!canTransition(assignment.status as AssignmentStatus, "COMPLETED")) {
      throw new Error(
        `Cannot transition assignment from ${assignment.status} to COMPLETED`
      );
    }
    if (!canOrderTransition(order.status, "COMPLETED")) {
      throw new Error(
        `Cannot transition order from ${order.status} to COMPLETED`
      );
    }

    const { updated, completedAt } = await completeOrderInTx(tx, {
      assignmentId,
      orderId: order.id,
      fromOrderStatus: "IN_PROGRESS",
      endReason: "Completed by booster",
    });
    return { assignment: updated, order, boosterId: assignment.boosterId as string, completedAt };
  });
  await afterOrderCompleted({
    orderId: result.order.id,
    customerId: result.order.userId,
    boosterId: result.boosterId,
    assignmentId,
    actorId: userId,
    previousStatus: result.order.status,
    completedAt: result.completedAt,
  });
  return result;
}

/**
 * The completion write, shared by the admin "Complete" and the confirmed
 * completion request (lib/orders/completion-request.service.ts). Must run in
 * the caller's transaction. Conditional on the order's current status, so a
 * concurrent completion makes it throw (P2025) and roll back.
 */
export async function completeOrderInTx(
  tx: Prisma.TransactionClient,
  p: { assignmentId: string; orderId: string; fromOrderStatus: "IN_PROGRESS" | "AWAITING_CONFIRMATION"; endReason: string; metadata?: Record<string, unknown> }
) {
  const completedAt = new Date();
  const updated = await tx.orderBoosterAssignment.update({
    where: { id: p.assignmentId },
    data: {
      status: "COMPLETED",
      endedAt: completedAt,
      endReason: p.endReason,
      activeOrderId: null,
    },
  });

  await transitionOrder(tx, {
    where: { id: p.orderId, status: p.fromOrderStatus },
    to: "COMPLETED",
    data: { completedAt },
  });

  const meta = { assignmentId: p.assignmentId, ...(p.metadata ?? {}) };
  await tx.orderEvent.create({
    data: { orderId: p.orderId, type: "ORDER_COMPLETED", message: "Order completed", metadata: meta as Prisma.InputJsonValue },
  });
  if (p.fromOrderStatus === "IN_PROGRESS") {
    await tx.orderEvent.create({
      data: { orderId: p.orderId, type: "COMPLETION_SUBMITTED", message: "Completion submitted", metadata: meta as Prisma.InputJsonValue },
    });
  }
  await tx.orderEvent.create({
    data: { orderId: p.orderId, type: "ASSIGNMENT_COMPLETED", message: "Assignment completed", metadata: meta as Prisma.InputJsonValue },
  });

  // Same transaction: attribute the reserved 55% booster share. Single
  // contributor -> that booster (PENDING, awaits admin release); several
  // contributors -> PENDING_REVIEW for an admin allocation. No-op for
  // unpaid / legacy orders.
  await allocateOnCompletion(tx, p.orderId, p.assignmentId);
  // Customer cashback (2026-11-24), once per order.
  await earnCashbackOnCompletion(tx, p.orderId, completedAt);
  return { updated, completedAt };
}

/** Side effects after a completion committed (best effort, idempotent). */
export async function afterOrderCompleted(p: {
  orderId: string;
  customerId: string;
  boosterId: string;
  assignmentId: string;
  actorId: string;
  previousStatus: string;
  completedAt: Date;
}) {
  await dispatchOutbox({ limit: 5 });

  // Revoke the booster's socket access to the order room
  await revokeOrderAccess({ userId: p.boosterId, orderId: p.orderId });

  // Customer, the completing booster and admins. The dedupe key guarantees a
  // single completion notification per recipient even if this is retried.
  await createNotificationsForEvent({
    type: "ORDER_COMPLETED",
    orderId: p.orderId,
    assignmentId: p.assignmentId,
    actorId: p.actorId,
    dedupeKey: `ORDER_COMPLETED:${p.orderId}`,
  });

  await broadcastToOrder({
    orderId: p.orderId,
    event: "order.completed",
    payload: {
      orderId: p.orderId,
      customerId: p.customerId,
      boosterId: p.boosterId,
      assignmentId: p.assignmentId,
      completedAt: p.completedAt.toISOString(),
    },
  });
  await broadcastToOrder({
    orderId: p.orderId,
    event: "order.status_changed",
    payload: {
      orderId: p.orderId,
      customerId: p.customerId,
      boosterId: p.boosterId,
      previousStatus: p.previousStatus,
      newStatus: "COMPLETED",
      changedAt: p.completedAt.toISOString(),
    },
  });

  await closeSessions(p.orderId, "COMPLETED");
}

export async function cancelAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined,
  reason?: string
) {
  // Cancelling the customer's whole order is an admin decision. A booster who
  // can no longer work on an order must abandon it (-> DRAFT, admin review).
  if (userRole !== "ADMIN") {
    throw new BoosterCancellationForbiddenError();
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

    if (!["IN_PROGRESS", "PAUSED", "ASSIGNED", "ACCEPTED"].includes(assignment.status)) {
      throw new Error(
        `Cannot cancel assignment in status ${assignment.status}`
      );
    }

    const boosterId = assignment.boosterId;

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "CANCELLED",
        endedAt: new Date(),
        endReason: reason || "Cancelled",
        activeOrderId: null,
      },
    });

    await transitionOrder(tx, {
      where: { id: order.id, status: { in: ["CLAIMED", "IN_PROGRESS", "PAUSED"] } },
      to: "CANCELLED",
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ORDER_CANCELLED",
        message: reason || "Order cancelled",
        metadata: { assignmentId },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_CANCELLED",
        message: reason || "Assignment cancelled",
        metadata: { assignmentId },
      },
    });

    return { assignment: updated, order, boosterId };
  });

  // Revoke the booster's real-time access to the order room
  await revokeOrderAccess({ userId: result.boosterId, orderId: result.order.id });

  await createNotificationsForEvent({
    type: "ORDER_CANCELLED",
    orderId: result.order.id,
    assignmentId,
    actorId: userId,
  });

    await broadcastToOrder({
      orderId: result.order.id,
      event: "order.cancelled",
      payload: {
        orderId: result.order.id,
        customerId: result.order.userId,
        boosterId: result.boosterId,
        assignmentId,
        reason: reason || "Cancelled",
        cancelledAt: new Date().toISOString(),
      },
    });
    await broadcastToOrder({
      orderId: result.order.id,
      event: "order.status_changed",
      payload: {
        orderId: result.order.id,
        customerId: result.order.userId,
        boosterId: result.boosterId,
        previousStatus: result.order.status,
        newStatus: "CANCELLED",
        changedAt: new Date().toISOString(),
      },
    });

  await closeSessions(result.order.id, "CANCELLED");
  return result;
}

export async function releaseAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined,
  reason?: string
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin) {
    // A booster dropping an order they hold is an abandonment: the order must
    // go to DRAFT for admin review, never straight back to the marketplace.
    return abandonOrder(assignmentId, userId, reason);
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

    if (!["IN_PROGRESS", "PAUSED", "ASSIGNED", "ACCEPTED"].includes(assignment.status)) {
      throw new Error(
        `Cannot release assignment in status ${assignment.status}`
      );
    }

    const boosterId = assignment.boosterId;
    // Only a paid order may go back to the marketplace (PENDING). An unpaid
    // one goes to DRAFT for admin review instead, so a release can never
    // make an unpaid order look published.
    const paid = hasVerifiedPayment(order);
    const nextStatus = paid ? "PENDING" : "DRAFT";

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "RELEASED",
        endedAt: new Date(),
        endReason: reason || "Released by admin",
        activeOrderId: null,
      },
    });
    // A margin kept on this booster's payout goes back into the booster share.
    const { restoreBidMargin } = await import("@/lib/pool/service");
    await restoreBidMargin(tx, order.id, assignmentId);

    await transitionOrder(tx, {
      where: {
        id: order.id,
        status: { in: ["CLAIMED", "IN_PROGRESS", "PAUSED"] },
        ...(paid ? VERIFIED_PAYMENT_WHERE : { paymentVerifiedAt: null }),
      },
      to: nextStatus,
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_RELEASED",
        message: reason || "Assignment released by admin",
        metadata: { assignmentId, boosterId, actorUserId: userId, reason: reason ?? null, nextStatus },
      },
    });
    if (nextStatus === "DRAFT") {
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ORDER_MOVED_TO_DRAFT",
          message: "Released by admin without a verified payment; moved to draft for review",
          metadata: { assignmentId, actorUserId: userId },
        },
      });
    }

    return { assignment: updated, order, boosterId, nextStatus };
  });

  // Revoke the previous booster's real-time access to the order room
      await revokeOrderAccess({ userId: result.boosterId, orderId: result.order.id });

  await createNotificationsForEvent({
    type: "BOOSTER_REMOVED",
    orderId: result.order.id,
    assignmentId,
    actorId: userId,
  });
  if (result.nextStatus === "PENDING") {
    await createNotificationsForEvent({
      type: "ORDER_REOPENED",
      orderId: result.order.id,
      assignmentId,
      actorId: userId,
    });
    await livePool("added");
  }

  await broadcastToOrder({
    orderId: result.order.id,
    event: "order.status_changed",
    payload: {
      orderId: result.order.id,
      customerId: result.order.userId,
      boosterId: result.boosterId,
      previousStatus: result.order.status,
      newStatus: result.nextStatus,
      changedAt: new Date().toISOString(),
    },
  });

  await closeSessions(result.order.id, "RELEASED");
  return result;
}

/**
 * Reassign an order from one booster to another (admin only).
 * This revokes the previous booster's access and assigns a new booster.
 */
export async function reassignOrder(
  orderId: string,
  newBoosterId: string,
  adminId: string,
  reason?: string
) {
  // Verify admin role
  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true },
  });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Only admins can reassign orders");
  }

  // Verify new booster eligibility
  await verifyBoosterEligibility(newBoosterId, "claim");

  const result = await prisma.$transaction(async (tx) => {
    // Find the current active assignment
    const currentAssignment = await tx.orderBoosterAssignment.findFirst({
      where: {
        orderId,
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      },
    });

    if (!currentAssignment) {
      throw new Error("No active assignment found for this order");
    }

    const previousBoosterId = currentAssignment.boosterId;

    // Release the current assignment
    await tx.orderBoosterAssignment.update({
      where: { id: currentAssignment.id },
      data: {
        status: "RELEASED",
        endedAt: new Date(),
        endReason: reason || `Reassigned by admin`,
        activeOrderId: null,
      },
    });

    // Create new assignment for the new booster. A claimed order that was
    // not started stays CLAIMED: the new booster starts it themself.
    const notStarted = currentAssignment.status === "ASSIGNED" || currentAssignment.status === "ACCEPTED";
    const newAssignment = await tx.orderBoosterAssignment.create({
      data: {
        orderId,
        boosterId: newBoosterId,
        assignedById: adminId,
        status: notStarted ? "ASSIGNED" : "IN_PROGRESS",
        activeOrderId: orderId,
        startedAt: notStarted ? null : new Date(),
        awardMode: "ADMIN",
        payoutAmount: currentAssignment.payoutAmount ?? null,
      },
    });

    // Conditional (previously unconditional): only a live order with a
    // verified payment may be handed to another booster.
    await transitionOrder(tx, {
      where: { id: orderId, status: { in: notStarted ? ["CLAIMED"] : ["IN_PROGRESS", "PAUSED"] }, ...VERIFIED_PAYMENT_WHERE },
      to: notStarted ? "CLAIMED" : "IN_PROGRESS",
    });

    // Record events
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "ASSIGNMENT_RELEASED",
        message: `Reassigned by admin: ${reason || "No reason provided"}`,
        metadata: { assignmentId: currentAssignment.id, previousBoosterId, newBoosterId },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "BOOSTER_ASSIGNED",
        message: "Booster assigned to order",
        metadata: { assignmentId: newAssignment.id, boosterId: newBoosterId },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "WORK_STARTED",
        message: "Work started",
        metadata: { assignmentId: newAssignment.id, boosterId: newBoosterId },
      },
    });

    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    return { previousBoosterId, newBoosterId, assignment: newAssignment, order: order! };
  });

  // Revoke the previous booster's real-time access
  await revokeOrderAccess({ userId: result.previousBoosterId, orderId: result.order.id });

  // Send notifications
  await Promise.all([
    createNotificationsForEvent({
      type: "BOOSTER_REASSIGNED",
      orderId: result.order.id,
      assignmentId: result.assignment.id,
      actorId: adminId,
      metadata: {
        previousBoosterId: result.previousBoosterId,
        newBoosterId: result.newBoosterId,
      },
    }),
    createNotificationsForEvent({
      type: "ORDER_STARTED",
      orderId: result.order.id,
      assignmentId: result.assignment.id,
      actorId: adminId,
    }),
  ]);

  await broadcastToOrder({
    orderId: result.order.id,
    event: "order.reassigned",
    payload: {
      orderId: result.order.id,
      customerId: result.order.userId,
      previousBoosterId: result.previousBoosterId,
      newBoosterId: result.newBoosterId,
      assignedById: adminId,
      assignmentId: result.assignment.id,
      status: result.order.status,
      assignedAt: new Date().toISOString(),
      reason,
    },
  });
  await broadcastToOrder({
    orderId: result.order.id,
    event: "order.started",
    payload: {
      orderId: result.order.id,
      customerId: result.order.userId,
      boosterId: result.newBoosterId,
      assignmentId: result.assignment.id,
      startedAt: new Date().toISOString(),
    },
  });

  await closeSessions(orderId, "RELEASED");
  return result;
}

/**
 * Booster abandons an order they are assigned to.
 *
 *  1. Only the assigned (approved) booster may abandon.
 *  2. The assignment is ended (RELEASED, endReason "ABANDONED: ...") and its
 *     activeOrderId cleared, so the booster loses access and the order no
 *     longer counts as an active booster order.
 *  3. The order moves to DRAFT. DRAFT is not claimable and is not listed in
 *     the marketplace; only an admin can edit and republish it.
 *  4. History (events, messages, matches) is preserved. Admins are notified.
 */
export const ABANDON_REASON_MAX_LENGTH = 500;

export async function abandonOrder(
  assignmentId: string,
  boosterId: string,
  reason?: string
) {
  await verifyBoosterEligibility(boosterId);

  const cleanReason = reason?.trim().slice(0, ABANDON_REASON_MAX_LENGTH) || null;

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    if (assignment.boosterId !== boosterId) {
      throw new NotBoosterOwnerError();
    }

    // A customer pause must be respected: the booster can neither keep
    // working on nor drop a paused order. Admins can still release/reassign.
    if (order.status === "PAUSED" || assignment.status === "PAUSED") {
      throw new OrderStateConflictError(
        "This order is paused by the customer and cannot be abandoned while paused. Contact support if you cannot continue."
      );
    }
    if (!["IN_PROGRESS", "ASSIGNED", "ACCEPTED"].includes(assignment.status)) {
      throw new Error(
        `Cannot abandon assignment in status ${assignment.status}`
      );
    }

    // Phase 6: a release within the grace window, before starting, puts the
    // order straight back in the pool with no strike. Otherwise: strike and
    // DRAFT for admin review.
    const graceMin = await getConfigIn(tx, "release_grace_min");
    const assignedAt = assignment.assignedAt ? new Date(assignment.assignedAt).getTime() : NaN;
    const inGrace =
      (assignment.status === "ASSIGNED" || assignment.status === "ACCEPTED") &&
      order.status === "CLAIMED" &&
      hasVerifiedPayment(order) &&
      Date.now() - assignedAt <= graceMin * 60_000;
    validateOrderTransition(order.status, inGrace ? "PENDING" : "DRAFT");

    const endedAt = new Date();
    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "RELEASED",
        endedAt,
        endReason: inGrace ? "RELEASED_IN_GRACE" : `ABANDONED: ${cleanReason ?? "No reason given"}`,
        activeOrderId: null,
      },
    });

    // A margin the platform kept on this booster's payout goes back into the booster share.
    const { restoreBidMargin } = await import("@/lib/pool/service");
    await restoreBidMargin(tx, order.id, assignmentId);

    if (inGrace) {
      await transitionOrder(tx, { where: { id: order.id, status: "CLAIMED", ...VERIFIED_PAYMENT_WHERE }, to: "PENDING" });
      // A trial booster gets the trial order back.
      if (assignment.awardMode) {
        await tx.boosterProfile.updateMany({
          where: { userId: boosterId, verificationStatus: "TRIAL" },
          data: { trialOrdersRemaining: { increment: 1 } },
        });
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "BOOSTER_RELEASED_IN_GRACE",
          message: "The booster released the order right after taking it; it is back in the pool",
          metadata: { assignmentId, boosterId },
        },
      });
      return { assignment: updated, order, endedAt, inGrace: true as const, strike: null };
    }

    await transitionOrder(tx, {
      where: { id: order.id, status: { in: ["CLAIMED", "IN_PROGRESS"] } },
      to: "DRAFT",
    });
    const { addStrike } = await import("@/lib/boosters/discipline");
    const strike = await addStrike(tx, { boosterId, orderId: order.id, code: "LATE_RELEASE", note: cleanReason });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "BOOSTER_ABANDONED",
        message: cleanReason ?? "Booster abandoned the order",
        metadata: { assignmentId, boosterId, reason: cleanReason, previousStatus: order.status },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ORDER_MOVED_TO_DRAFT",
        message: "Order moved to draft for admin review",
        metadata: { assignmentId, actorUserId: boosterId },
      },
    });

    return { assignment: updated, order, endedAt, inGrace: false as const, strike };
  });

  // Revoke the booster's real-time access
  await revokeOrderAccess({ userId: boosterId, orderId: result.order.id });
  await adviseLoginChange(result.order.id, boosterId);

  if (result.inGrace) {
    await createNotificationsForEvent({ type: "ORDER_REOPENED", orderId: result.order.id, assignmentId, actorId: boosterId, dedupeKey: `ORDER_REOPENED:${assignmentId}` });
    await broadcastToOrder({
      orderId: result.order.id,
      event: "order.status_changed",
      payload: {
        orderId: result.order.id,
        customerId: result.order.userId,
        boosterId,
        previousStatus: result.order.status,
        newStatus: "PENDING",
        changedAt: result.endedAt.toISOString(),
      },
    });
    await closeSessions(result.order.id, "RELEASED");
    await livePool("added");
    return result;
  }
  if (result.strike) {
    const { notifyStrike } = await import("@/lib/boosters/discipline");
    await notifyStrike(result.strike);
  }

  await createNotificationsForEvent({
    type: "BOOSTER_ABANDONED",
    orderId: result.order.id,
    assignmentId,
    actorId: boosterId,
    metadata: cleanReason ? { reason: cleanReason } : undefined,
    dedupeKey: `BOOSTER_ABANDONED:${assignmentId}`,
  });

  await broadcastToOrder({
    orderId: result.order.id,
    event: "order.status_changed",
    payload: {
      orderId: result.order.id,
      customerId: result.order.userId,
      boosterId,
      previousStatus: result.order.status,
      newStatus: "DRAFT",
      changedAt: result.endedAt.toISOString(),
    },
  });

  await closeSessions(result.order.id, "RELEASED");
  return result;
}

/**
 * Stalled orders (2026-11-24): take an order back from a booster who has
 * had no activity for `hours` (lib/boosters/stall.ts decides when).
 *
 *  - Never started (order CLAIMED): back to the pool, a new booster takes it.
 *  - In progress: DRAFT for admin review (pay for work done, new price).
 *  - The booster is fined a share of the payout (issueAutoReleaseFineTx),
 *    with a strike; repeat offenders pay double and the 3rd release in 30
 *    days blocks new claims.
 *
 * Conditional on the assignment still being in the status it was read in,
 * so a booster acting at the last second (or a second job run) wins the race
 * and nothing is released twice. Returns null when nothing was done.
 */
export async function autoReleaseStalledAssignment(assignmentId: string, opts: { hours: number; now?: Date }) {
  const now = opts.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) return null;
    const { assignment, order } = loaded;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(assignment.status)) return null;
    if (!["CLAIMED", "IN_PROGRESS"].includes(order.status)) return null; // paused, completed, cancelled...

    const started = assignment.status === "IN_PROGRESS" || order.status === "IN_PROGRESS";
    const toPool = !started && order.status === "CLAIMED" && hasVerifiedPayment(order);
    validateOrderTransition(order.status, toPool ? "PENDING" : "DRAFT");

    const ended = await tx.orderBoosterAssignment.updateMany({
      where: { id: assignmentId, status: assignment.status },
      data: { status: "RELEASED", endedAt: now, endReason: `AUTO_RELEASED: no activity for ${opts.hours} h`, activeOrderId: null },
    });
    if (ended.count === 0) return null;

    const snapshot = await tx.orderPricingSnapshot.findUnique({ where: { orderId: order.id }, select: { boosterShareAmount: true, currency: true } });
    const full = order as typeof order & { boosterPayoutAmount?: number | null; currency?: string | null };
    const payout = assignment.payoutAmount ?? full.boosterPayoutAmount ?? snapshot?.boosterShareAmount ?? 0;
    const currency = snapshot?.currency ?? full.currency ?? "EUR";

    const { restoreBidMargin } = await import("@/lib/pool/service");
    await restoreBidMargin(tx, order.id, assignmentId);

    if (toPool) {
      await transitionOrder(tx, { where: { id: order.id, status: "CLAIMED", ...VERIFIED_PAYMENT_WHERE }, to: "PENDING" });
    } else {
      await transitionOrder(tx, { where: { id: order.id, status: { in: ["CLAIMED", "IN_PROGRESS"] } }, to: "DRAFT" });
    }

    const { issueAutoReleaseFineTx } = await import("@/lib/boosters/discipline");
    const penalty = await issueAutoReleaseFineTx(tx, {
      boosterId: assignment.boosterId,
      orderId: order.id,
      started,
      payout,
      currency,
      hours: opts.hours,
      now,
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "BOOSTER_AUTO_RELEASED",
        message: `Taken back from the booster after ${opts.hours} hours without activity`,
        metadata: {
          assignmentId,
          boosterId: assignment.boosterId,
          previousStatus: order.status,
          toPool,
          fineId: penalty.fine?.id ?? null,
          fineAmount: penalty.fine?.amount ?? 0,
          offence: penalty.offence,
          blocked: penalty.blocked,
        },
      },
    });
    if (!toPool) {
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "ORDER_MOVED_TO_DRAFT", message: "Order moved to draft for admin review", metadata: { assignmentId, actorUserId: null } },
      });
    }
    await enqueueOutbox(tx, [
      {
        type: "EMAIL_BOOSTER_STALL",
        dedupeKey: `stall-released:${assignmentId}`,
        payload: { orderId: order.id, boosterId: assignment.boosterId, kind: "released", hours: opts.hours, fineMinor: penalty.fine?.amount ?? 0, currency, blocked: penalty.blocked },
      },
    ]);
    return { order, boosterId: assignment.boosterId as string, toPool, currency, penalty };
  });
  if (!result) return null;

  const { order, boosterId, toPool, currency, penalty } = result;
  await revokeOrderAccess({ userId: boosterId, orderId: order.id });
  await adviseLoginChange(order.id, boosterId);
  await closeSessions(order.id, "RELEASED");

  const { formatMoney } = await import("@/lib/money");
  const { createNotification } = await import("@/lib/notifications/service");
  const { notifyStrike } = await import("@/lib/boosters/discipline");
  const fine = penalty.fine ? formatMoney(penalty.fine.amount, currency) : "none";
  const base = { orderId: order.id, hours: opts.hours, fine, toPool, blocked: penalty.blocked, repeat: penalty.multiplier > 1 ? penalty.offence : null };
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const sends: [string, Record<string, unknown>][] = [
    [boosterId, { ...base, audience: "booster" }],
    [order.userId, { ...base, audience: "customer" }],
    ...admins.map((a) => [a.id, { ...base, audience: "admin" }] as [string, Record<string, unknown>]),
  ];
  await Promise.all(
    sends.map(([userId, meta]) =>
      createNotification(userId, "ORDER_AUTO_RELEASED", order.id, meta, "system", { dedupeKey: `auto-release:${assignmentId}` }).catch((e) =>
        logger.warn("Auto-release notification failed", { error: e instanceof Error ? e.message : "unknown" })
      )
    )
  );
  await notifyStrike(penalty.strike);

  await broadcastToOrder({
    orderId: order.id,
    event: "order.status_changed",
    payload: { orderId: order.id, customerId: order.userId, boosterId, previousStatus: order.status, newStatus: toPool ? "PENDING" : "DRAFT", changedAt: now.toISOString() },
  });
  if (toPool) await livePool("added");
  await dispatchOutbox({ limit: 10 }).catch(() => {});
  return { orderId: order.id, toPool, fine: penalty.fine, offence: penalty.offence, blocked: penalty.blocked };
}
