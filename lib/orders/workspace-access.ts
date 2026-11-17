/**
 * Order workspace access policy.
 *
 * Single source of truth for "what may this user do in this order's
 * workspace?". Pure (no I/O) so it is exhaustively unit-tested; every page and
 * API route of the workspace resolves access through it server-side. Hiding a
 * button in the UI is never the enforcement mechanism.
 *
 *  - CUSTOMER: only the order owner.
 *  - BOOSTER:  only the booster holding the order's ACTIVE assignment
 *              (activeOrderId === order.id). The booster who completed the
 *              order keeps read-only access to its history. Released /
 *              abandoned / declined / cancelled boosters lose access.
 *  - ADMIN:    every order.
 *
 * Order actions (all re-validated by the service layer):
 *  - Customer: pause (IN_PROGRESS) and resume (PAUSED) their own order.
 *  - Booster:  complete / abandon, only while the order is IN_PROGRESS.
 *              Claiming happens from the marketplace, not the workspace.
 */

import { isCheckoutHold } from "./payment-gate";

export type WorkspaceViewerRole = "customer" | "booster" | "admin";

export interface WorkspaceAccessUser {
  id: string;
  role: string | null | undefined;
}

export interface WorkspaceAccessAssignment {
  id: string;
  boosterId: string;
  status: string;
  activeOrderId: string | null;
}

export interface WorkspaceAccessOrder {
  id: string;
  userId: string;
  status: string;
  assignments: WorkspaceAccessAssignment[];
  /** With pricingSnapshot: identifies a checkout hold (payment-gate.ts). */
  paymentVerifiedAt?: Date | null;
  pricingSnapshot?: unknown;
}

export interface WorkspaceAccess {
  viewerRole: WorkspaceViewerRole;
  /** The viewer's own active assignment (boosters only). */
  activeAssignment: WorkspaceAccessAssignment | null;
  /** Read-only access to a finished order (completing booster). */
  readOnly: boolean;
  canChat: boolean;
  /** Booster holds a working (IN_PROGRESS or PAUSED) assignment. */
  canManageAssignment: boolean;
  /** Booster may mark the order complete (never while paused). */
  canCompleteOrder: boolean;
  /** Booster may abandon the order (never while paused). */
  canAbandonOrder: boolean;
  /** Assigned booster may start a CLAIMED order. */
  canStartOrder: boolean;
  /** Customer owner may pause their in-progress order. */
  canPauseOrder: boolean;
  /** Customer owner may resume their paused order. */
  canResumeOrder: boolean;
  /** Edit the Riot ID / region (customer owner, or admin). */
  canEditRiotAccount: boolean;
  /** Trigger a Riot data sync. */
  canSyncRiot: boolean;
  /** Edit / republish a DRAFT order. */
  canManageDraft: boolean;
}

const OPEN_STATUSES = new Set(["PENDING", "CLAIMED", "IN_PROGRESS", "PAUSED", "AWAITING_CONFIRMATION"]);
// SUBMITTED: completion waiting for the customer. The booster keeps the
// workspace and chat but has no actions (and no login access).
const ACTIVE_ASSIGNMENT = new Set(["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED", "SUBMITTED"]);

const NO_ACTIONS = {
  canCompleteOrder: false,
  canAbandonOrder: false,
  canStartOrder: false,
  canPauseOrder: false,
  canResumeOrder: false,
} as const;

/** The assignment currently holding the order, whoever it belongs to. */
function holdingAssignment(order: WorkspaceAccessOrder) {
  return (
    order.assignments.find((a) => a.activeOrderId === order.id && ACTIVE_ASSIGNMENT.has(a.status)) ?? null
  );
}

export function resolveWorkspaceAccess(
  user: WorkspaceAccessUser | null | undefined,
  order: WorkspaceAccessOrder | null | undefined
): WorkspaceAccess | null {
  if (!user || !order) return null;

  if (user.role === "ADMIN") {
    return {
      viewerRole: "admin",
      activeAssignment: null,
      readOnly: false,
      canChat: true,
      canManageAssignment: false,
      ...NO_ACTIONS,
      canEditRiotAccount: OPEN_STATUSES.has(order.status) || order.status === "DRAFT",
      canSyncRiot: true,
      canManageDraft: order.status === "DRAFT",
    };
  }

  if (user.role === "BOOSTER") {
    const active = order.assignments.find(
      (a) =>
        a.boosterId === user.id &&
        a.activeOrderId === order.id &&
        ACTIVE_ASSIGNMENT.has(a.status)
    );
    if (active) {
      const working = active.status === "IN_PROGRESS" || active.status === "PAUSED";
      // A paused order (paused by the customer) blocks every booster action.
      const live = active.status === "IN_PROGRESS" && order.status === "IN_PROGRESS";
      // Taken but not started yet: start it, or drop it.
      const claimed = (active.status === "ASSIGNED" || active.status === "ACCEPTED") && order.status === "CLAIMED";
      return {
        viewerRole: "booster",
        activeAssignment: active,
        readOnly: false,
        canChat: true,
        canManageAssignment: working || claimed,
        ...NO_ACTIONS,
        canCompleteOrder: live,
        canAbandonOrder: live || claimed,
        canStartOrder: claimed,
        canEditRiotAccount: false,
        canSyncRiot: true,
        canManageDraft: false,
      };
    }
    const completedByViewer =
      order.status === "COMPLETED" &&
      order.assignments.some((a) => a.boosterId === user.id && a.status === "COMPLETED");
    if (completedByViewer) {
      return {
        viewerRole: "booster",
        activeAssignment: null,
        readOnly: true,
        canChat: false,
        canManageAssignment: false,
        ...NO_ACTIONS,
        canEditRiotAccount: false,
        canSyncRiot: false,
        canManageDraft: false,
      };
    }
    return null;
  }

  if (user.role === "CUSTOMER" || user.role == null) {
    if (order.userId !== user.id) return null;
    // A checkout hold is not an order: the customer cannot open it.
    if (isCheckoutHold(order)) return null;
    const open = OPEN_STATUSES.has(order.status);
    const holder = holdingAssignment(order);
    return {
      viewerRole: "customer",
      activeAssignment: null,
      readOnly: !open,
      canChat: true,
      canManageAssignment: false,
      ...NO_ACTIONS,
      canPauseOrder: order.status === "IN_PROGRESS" && holder?.status === "IN_PROGRESS",
      canResumeOrder: order.status === "PAUSED" && holder?.status === "PAUSED",
      canEditRiotAccount: open || order.status === "DRAFT",
      canSyncRiot: open,
      canManageDraft: false,
    };
  }

  return null;
}

/** Prisma include that loads exactly what `resolveWorkspaceAccess` needs. */
export const WORKSPACE_ACCESS_SELECT = {
  id: true,
  userId: true,
  status: true,
  paymentVerifiedAt: true,
  pricingSnapshot: { select: { id: true } },
  assignments: {
    select: { id: true, boosterId: true, status: true, activeOrderId: true },
  },
} as const;
