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
/**
 * Completion submitted with proof, waiting for the customer. Neither active
 * (does not count toward the booster's order limit) nor finished (keeps
 * activeOrderId: workspace and chat stay open; an admin may send it back).
 */
export const SUBMITTED_ASSIGNMENT_STATUS = "SUBMITTED" as const;

export type AssignmentStatus =
  | ActiveAssignmentStatus
  | InactiveAssignmentStatus
  | typeof SUBMITTED_ASSIGNMENT_STATUS;

/**
 * Valid status transitions for a single assignment lifecycle.
 *
 * Taking an order creates an ASSIGNED assignment (order CLAIMED); the
 * booster starts it (ASSIGNED -> IN_PROGRESS, order CLAIMED -> IN_PROGRESS). Paused assignments stay active (they keep
 * their activeOrderId) and must not be claimable by another booster.
 */
export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> =
  {
    ASSIGNED: ["IN_PROGRESS", "ACCEPTED", "DECLINED", "CANCELLED", "RELEASED"],
    ACCEPTED: ["IN_PROGRESS", "CANCELLED", "RELEASED"],
    IN_PROGRESS: ["PAUSED", "SUBMITTED", "COMPLETED", "CANCELLED", "RELEASED"],
    // Waiting for the customer: confirmed -> COMPLETED; sent back -> IN_PROGRESS.
    SUBMITTED: ["COMPLETED", "IN_PROGRESS"],
    // Paused by the customer: only the customer's resume (or an admin
    // action) moves it on. Never COMPLETED directly.
    PAUSED: ["IN_PROGRESS", "CANCELLED"],
    COMPLETED: [],
    DECLINED: [],
    CANCELLED: [],
    RELEASED: [],
  };

/**
 * Order status progression triggered by assignment events.
 *
 * Target statuses: PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED, DRAFT.
 *
 * DRAFT is entered when the assigned booster abandons the order. It is NOT
 * claimable; only an admin may move DRAFT -> PENDING (republish) or cancel it.
 */
export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  // Only a verified payment confirmation may move AWAITING_PAYMENT -> PENDING
  // (not implemented in Phase 1: there is no code path that does it).
  AWAITING_PAYMENT: ["PENDING", "CANCELLED"],
  PENDING: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["IN_PROGRESS", "CANCELLED", "DRAFT", "PENDING"],
  IN_PROGRESS: ["PAUSED", "AWAITING_CONFIRMATION", "COMPLETED", "CANCELLED", "DRAFT"],
  AWAITING_CONFIRMATION: ["COMPLETED", "IN_PROGRESS"],
  PAUSED: ["IN_PROGRESS", "CANCELLED", "DRAFT"],
  COMPLETED: [],
  CANCELLED: [],
  DRAFT: ["PENDING", "CANCELLED"],
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

/**
 * Boosters may not cancel a customer's order. They abandon it instead, which
 * returns it to DRAFT for admin review.
 */
export class BoosterCancellationForbiddenError extends Error {
  constructor() {
    super(
      "Boosters cannot cancel customer orders. Abandon the order instead; it will be returned for admin review."
    );
    this.name = "BoosterCancellationForbiddenError";
  }
}

export class OrderNotClaimableError extends Error {
  constructor(reason: string) {
    super(`Order is not claimable: ${reason}`);
    this.name = "OrderNotClaimableError";
  }
}

/** The caller is not the customer who owns the order. */
export class NotOrderOwnerError extends Error {
  constructor() {
    super("Only the customer who placed this order can do that.");
    this.name = "NotOrderOwnerError";
  }
}

/**
 * The requested action is not valid for the order's current state (e.g.
 * completing or abandoning a paused order, pausing a completed one), or the
 * state changed concurrently. Mapped to HTTP 409.
 */
/**
 * Booster pressed Complete but Riot does not confirm the target (or cannot
 * check it). The order stays in progress; admins were notified.
 */
export class CompletionNotConfirmedError extends Error {
  constructor(
    public readonly result: "not_reached" | "cannot_verify",
    public readonly reason: string,
    public readonly current: string | null,
    public readonly target: string | null
  ) {
    super(
      result === "not_reached"
        ? "The target rank is not reached yet. Keep playing until it is; an admin has been notified and will contact you soon."
        : "We could not confirm the result automatically. An admin has been notified and will contact you soon."
    );
    this.name = "CompletionNotConfirmedError";
  }
}

export class OrderStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderStateConflictError";
  }
}
