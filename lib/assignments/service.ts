/**
 * Assignment service - handles all booster assignment operations with
 * transactions, concurrency control, and business logic.
 *
 * Simplified order lifecycle:
 *   PENDING --(claim)--> IN_PROGRESS --(pause)--> PAUSED --(resume)--> IN_PROGRESS
 *   IN_PROGRESS/PAUSED --(complete)--> COMPLETED
 *   IN_PROGRESS/PAUSED --(cancel)--> CANCELLED
 *
 * Claiming an order moves it straight to IN_PROGRESS: there is no separate
 * accept/start step. Paused assignments stay active (activeOrderId is kept)
 * so a paused order is never shown as available to another booster.
 */
import prisma from "@/lib/prisma";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  type ActiveAssignmentStatus,
  AssignmentStatus,
  BoosterNotEligibleError,
  canOrderTransition,
  canTransition,
  NotBoosterOwnerError,
  OrderAlreadyClaimedError,
  OrderNotClaimableError,
  OrderNotFoundError,
  validateAssignmentTransition,
  validateOrderTransition,
} from "./types";
import { Prisma } from "@/app/generated/prisma/client";

export async function verifyBoosterEligibility(userId: string) {
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

  if (user.boosterProfile.verificationStatus !== "APPROVED") {
    throw new BoosterNotEligibleError(
      "Booster is not approved. Pending, rejected or suspended boosters cannot claim orders."
    );
  }

  return { user, boosterProfile: user.boosterProfile };
}

export function isOrderClaimable(order: { status: string; assignments?: unknown[] }): boolean {
  if (order.status !== "PENDING") {
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

export async function getBoosterAssignments(
  boosterId: string,
  filter?: "active" | "all" | "history"
) {
  let where: any = {
    boosterId,
  };

  if (filter === "active") {
    where.status = { in: [...ACTIVE_ASSIGNMENT_STATUSES] };
  } else if (filter === "history") {
    where.status = { in: ["COMPLETED", "DECLINED", "CANCELLED", "RELEASED"] };
  }

  const assignments = await prisma.orderBoosterAssignment.findMany({
    where,
    include: {
      order: true,
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
): Promise<{ assignment: any; order: any } | null> {
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

export async function claimOrder(orderId: string, boosterId: string) {
  await verifyBoosterEligibility(boosterId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const activeAssignment = await tx.orderBoosterAssignment.findFirst({
        where: {
          orderId,
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        },
      });

      if (activeAssignment) {
        throw new OrderAlreadyClaimedError();
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new OrderNotFoundError(orderId);
      }

      if (order.status !== "PENDING") {
        throw new OrderNotClaimableError(
          `order is ${order.status}, expected PENDING`
        );
      }

      const assignment = await tx.orderBoosterAssignment.create({
        data: {
          orderId,
          boosterId,
          assignedById: boosterId,
          status: "IN_PROGRESS",
          activeOrderId: orderId,
          startedAt: new Date(),
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId, status: "PENDING" },
        data: { status: "IN_PROGRESS" },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          type: "ORDER_CLAIMED",
          message: "Order claimed by booster",
          metadata: { assignmentId: assignment.id, boosterId },
        },
      });

      return { assignment, order: updatedOrder };
    });

    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new OrderAlreadyClaimedError();
    }
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "P2025"
    ) {
      throw new OrderNotClaimableError("order was claimed by another booster");
    }
    throw error;
  }
}

export async function pauseAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin) {
    await verifyBoosterEligibility(userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

    if (assignment.status !== "IN_PROGRESS") {
      throw new Error(
        `Cannot pause assignment in status ${assignment.status}`
      );
    }
    if (order.status !== "IN_PROGRESS") {
      throw new Error(`Cannot pause order in status ${order.status}`);
    }

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: { status: "PAUSED" },
    });

    await tx.order.update({
      where: { id: order.id, status: "IN_PROGRESS" },
      data: { status: "PAUSED" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ORDER_PAUSED",
        message: "Order paused by booster",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}

export async function resumeAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin) {
    await verifyBoosterEligibility(userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

    if (assignment.status !== "PAUSED") {
      throw new Error(
        `Cannot resume assignment in status ${assignment.status}`
      );
    }
    if (order.status !== "PAUSED") {
      throw new Error(`Cannot resume order in status ${order.status}`);
    }

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: { status: "IN_PROGRESS" },
    });

    await tx.order.update({
      where: { id: order.id, status: "PAUSED" },
      data: { status: "IN_PROGRESS" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ORDER_RESUMED",
        message: "Order resumed by booster",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}

export async function completeAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin) {
    await verifyBoosterEligibility(userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

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

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        endReason: "Completed by booster",
        activeOrderId: null,
      },
    });

    await tx.order.update({
      where: { id: order.id, status: { in: ["IN_PROGRESS", "PAUSED"] } },
      data: { status: "COMPLETED" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_COMPLETED",
        message: "Assignment completed",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}

export async function cancelAssignment(
  assignmentId: string,
  userId: string,
  userRole: string | null | undefined,
  reason?: string
) {
  const isAdmin = userRole === "ADMIN";
  if (!isAdmin) {
    await verifyBoosterEligibility(userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    assertAssignmentAccess(assignment, userId, userRole);

    if (!["IN_PROGRESS", "PAUSED"].includes(assignment.status)) {
      throw new Error(
        `Cannot cancel assignment in status ${assignment.status}`
      );
    }

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "CANCELLED",
        endedAt: new Date(),
        endReason: reason || "Cancelled",
        activeOrderId: null,
      },
    });

    await tx.order.update({
      where: { id: order.id, status: { in: ["IN_PROGRESS", "PAUSED"] } },
      data: { status: "CANCELLED" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_CANCELLED",
        message: reason || "Assignment cancelled",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

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
    await verifyBoosterEligibility(userId);
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

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "RELEASED",
        endedAt: new Date(),
        endReason: reason || "Released by booster",
        activeOrderId: null,
      },
    });

    await tx.order.update({
      where: { id: order.id, status: { in: ["IN_PROGRESS", "PAUSED"] } },
      data: { status: "PENDING" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_RELEASED",
        message: reason || "Assignment released by booster",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}

// Legacy accept/start steps retained for historical compatibility but no
// longer part of the claim flow. Claiming now starts work immediately.
export async function declineAssignment(
  assignmentId: string,
  boosterId: string,
  reason?: string
) {
  await verifyBoosterEligibility(boosterId);

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    if (assignment.boosterId !== boosterId) {
      throw new NotBoosterOwnerError();
    }

    if (!canTransition(assignment.status as AssignmentStatus, "DECLINED")) {
      throw new Error(
        `Cannot transition from ${assignment.status} to DECLINED`
      );
    }

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "DECLINED",
        endedAt: new Date(),
        endReason: reason || "Declined by booster",
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_DECLINED",
        message: reason || "Assignment declined by booster",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}

export async function acceptAssignment(assignmentId: string, boosterId: string) {
  await verifyBoosterEligibility(boosterId);

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    if (assignment.boosterId !== boosterId) {
      throw new NotBoosterOwnerError();
    }

    if (!canTransition(assignment.status as AssignmentStatus, "ACCEPTED")) {
      throw new Error(
        `Cannot transition from ${assignment.status} to ACCEPTED`
      );
    }

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    await tx.order.update({
      where: { id: order.id, status: "PENDING" },
      data: { status: "IN_PROGRESS" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_ACCEPTED",
        message: "Assignment accepted by booster",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}

export async function startAssignment(assignmentId: string, boosterId: string) {
  await verifyBoosterEligibility(boosterId);

  const result = await prisma.$transaction(async (tx) => {
    const loaded = await loadAssignmentAndOrder(tx, assignmentId);
    if (!loaded) {
      throw new Error("Assignment not found");
    }

    const { assignment, order } = loaded;
    if (assignment.boosterId !== boosterId) {
      throw new NotBoosterOwnerError();
    }

    if (!canTransition(assignment.status as AssignmentStatus, "IN_PROGRESS")) {
      throw new Error(
        `Cannot transition from ${assignment.status} to IN_PROGRESS`
      );
    }

    const updated = await tx.orderBoosterAssignment.update({
      where: { id: assignmentId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { status: "IN_PROGRESS" },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ASSIGNMENT_STARTED",
        message: "Work started on assignment",
        metadata: { assignmentId },
      },
    });

    return updated;
  });

  return result;
}
