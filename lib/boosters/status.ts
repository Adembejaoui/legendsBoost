/**
 * What each booster status allows. PURE: the single source for every
 * "is this booster allowed to ..." check (pages, realtime, claim, payouts).
 * PENDING = application submitted; APPROVED = active booster.
 */
export type BoosterStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "NEEDS_INFO"
  | "REJECTED"
  | "TRIAL"
  | "APPROVED"
  | "ON_BREAK"
  | "SUSPENDED"
  | "TERMINATED";

/** Booster dashboard, existing orders (workspace, chat) and payouts. */
export const BOOSTER_ACCESS_STATUSES: readonly BoosterStatus[] = ["APPROVED", "TRIAL", "ON_BREAK"];

/** Still an applicant (the become-booster page shows the application). */
export const APPLICANT_STATUSES: readonly BoosterStatus[] = ["PENDING", "UNDER_REVIEW", "NEEDS_INFO", "REJECTED"];

export function hasBoosterAccess(status: string | null | undefined): boolean {
  return !!status && (BOOSTER_ACCESS_STATUSES as readonly string[]).includes(status);
}

/**
 * May take NEW orders. ON_BREAK keeps its current orders but takes none;
 * TRIAL only while it has trial orders left.
 */
export function canClaimNewOrders(status: string | null | undefined, trialOrdersRemaining: number | null | undefined): boolean {
  if (status === "APPROVED") return true;
  if (status === "TRIAL") return (trialOrdersRemaining ?? 0) > 0;
  return false;
}

export const BOOSTER_STATUS_LABEL: Record<BoosterStatus, string> = {
  PENDING: "Application submitted",
  UNDER_REVIEW: "Under review",
  NEEDS_INFO: "More information needed",
  REJECTED: "Rejected",
  TRIAL: "Trial",
  APPROVED: "Active",
  ON_BREAK: "On break",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
};
