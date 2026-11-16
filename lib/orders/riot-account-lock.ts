/**
 * When may an order's Riot account be changed or unlinked?
 *
 * Match evidence and progress are tied to the account, so it is locked as
 * soon as boosting has started. Pure function, shared by the API route (the
 * enforcement point) and the workspace view model (so the UI agrees).
 *
 *  - Any assignment that has started (startedAt set, not DECLINED): locked
 *    for customers and boosters. This covers active, paused, completed and
 *    released/abandoned assignments: work happened on this account.
 *  - A progress baseline was captured: locked for non-admins.
 *  - Order matches exist: locked for EVERYONE, admins included. Changing the
 *    account would either delete that evidence or mix two accounts' games;
 *    both are refused.
 * Admins may still correct the account after work started as long as no
 * match has been recorded (e.g. a typo noticed before the first sync).
 */
export interface RiotAccountLockInput {
  baselineAt: Date | null | undefined;
  assignments: { startedAt: Date | null; status: string }[];
  matchCount: number;
}

export type RiotAccountLock =
  | { locked: false }
  | { locked: true; reason: "matches_recorded" | "work_started" | "baseline_captured"; message: string };

export function getRiotAccountLock(input: RiotAccountLockInput, isAdmin: boolean): RiotAccountLock {
  if (input.matchCount > 0) {
    return {
      locked: true,
      reason: "matches_recorded",
      message: "Order matches are already recorded for this Riot account, so it can no longer be changed.",
    };
  }
  if (isAdmin) return { locked: false };
  if (input.assignments.some((a) => a.startedAt && a.status !== "DECLINED")) {
    return {
      locked: true,
      reason: "work_started",
      message: "The Riot account is locked because boosting has started. Contact support if it is wrong.",
    };
  }
  if (input.baselineAt) {
    return {
      locked: true,
      reason: "baseline_captured",
      message: "The Riot account is locked once progress tracking has started.",
    };
  }
  return { locked: false };
}
