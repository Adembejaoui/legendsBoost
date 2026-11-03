/**
 * Shared types and validation utilities for booster assignment workflow.
 *
 * This module centralizes assignment status transitions, active-status
 * helpers and order-status integration rules so every API endpoint
 * (admin or booster) enforces the same invariants.
 */

export const ACTIVE_ASSIGNMENT_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "PAUSED",
] as const;

export const INACTIVE_ASSIGNMENT_STATUSES = [
  "COMPLETED",
  "DECLINED",
  "CANCELLED",
  "RELEASED",
] as const;

export type ActiveAssignmentStatus = (typeof ACTIVE_ASSIGNMENT_STATUSES)[number];
export type InactiveAssignmentStatus = (typeof INACTIVE_ASSIGNMENT_STATUSES)[number];
export type AssignmentStatus =
  | ActiveAssignmentStatus
  | InactiveAssignmentStatus;

/**
 * Valid status transitions for a single assignment lifecycle.
 *
 * Claiming an order now moves the assignment straight to IN_PROGRESS: there is
 * no separate accept/start step. Paused assignments stay active (they keep
 * their activeOrderId) and must not be claimable by another booster.
 */
export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> =
  {
    ASSIGNED: ["ACCEPTED", "DECLINED", "CANCELLED", "RELEASED"],
    ACCEPTED: ["IN_PROGRESS", "CANCELLED", "RELEASED"],
    IN_PROGRESS: ["PAUSED", "COMPLETED", "CANCELLED", "RELEASED"],
    PAUSED: ["IN_PROGRESS", "CANCELLED"],
    COMPLETED: [],
    DECLINED: [],
    CANCELLED: [],
    RELEASED: [],
  };

/**
 * Order status progression triggered by assignment events.
 *
 * Target statuses: PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED.
 */
export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function isAssignmentActive(status: AssignmentStatus): boolean {
  return (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

export function isAssignmentInactive(status: AssignmentStatus): boolean {
  return (INACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

export function canTransition(
  from: AssignmentStatus,
  to: AssignmentStatus
): boolean {
  return ASSIGNMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canOrderTransition(from: string, to: string): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateAssignmentTransition(
  from: AssignmentStatus,
  to: AssignmentStatus
): void {
  if (!canTransition(from, to)) {
    throw new InvalidAssignmentTransitionError(from, to);
  }
}

export function validateOrderTransition(from: string, to: string): void {
  if (!canOrderTransition(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}

export class InvalidAssignmentTransitionError extends Error {
  constructor(from: AssignmentStatus, to: AssignmentStatus) {
    super(
      `Invalid assignment transition: ${from} -> ${to}. Allowed: ${
        ASSIGNMENT_TRANSITIONS[from]?.join(", ") || "none"
      }`
    );
    this.name = "InvalidAssignmentTransitionError";
  }
}

export class InvalidOrderTransitionError extends Error {
  constructor(from: string, to: string) {
    super(
      `Invalid order status transition: ${from} -> ${to}. Allowed: ${
        ORDER_STATUS_TRANSITIONS[from]?.join(", ") || "none"
      }`
    );
    this.name = "InvalidOrderTransitionError";
  }
}

export class ActiveAssignmentExistsError extends Error {
  constructor(orderId: string) {
    super(
      `Cannot create a new assignment: order ${orderId} already has an active assignment.`
    );
    this.name = "ActiveAssignmentExistsError";
  }
}

export class AssignmentNotFoundError extends Error {
  constructor(assignmentId: string) {
    super(`Assignment ${assignmentId} not found.`);
    this.name = "AssignmentNotFoundError";
  }
}

export class NotBoosterOwnerError extends Error {
  constructor() {
    super("Assignment does not belong to the authenticated booster.");
    this.name = "NotBoosterOwnerError";
  }
}

export class BoosterNotEligibleError extends Error {
  constructor(reason: string) {
    super(`Booster is not eligible: ${reason}`);
    this.name = "BoosterNotEligibleError";
  }
}

export class AssignmentAlreadyActiveError extends Error {
  constructor() {
    super("Assignment is already active.");
    this.name = "AssignmentAlreadyActiveError";
  }
}

export class AssignmentAlreadyInactiveError extends Error {
  constructor() {
    super("Assignment is already inactive.");
    this.name = "AssignmentAlreadyInactiveError";
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found.`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderAlreadyClaimedError extends Error {
  constructor() {
    super("This order has already been claimed.");
    this.name = "OrderAlreadyClaimedError";
  }
}

export class OrderNotClaimableError extends Error {
  constructor(reason: string) {
    super(`Order is not claimable: ${reason}`);
    this.name = "OrderNotClaimableError";
  }
}
