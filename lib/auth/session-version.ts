/**
 * "Sign out everywhere": the session token stores the account's
 * sessionVersion at sign-in. Every session lookup filters on it, so after a
 * password change or reset (which bumps the number) older sessions find no
 * user and are treated as signed out.
 */
export function sessionVersionOf(session: { user?: unknown } | null | undefined): number {
  const v = (session?.user as { sv?: unknown } | undefined)?.sv;
  return typeof v === "number" && Number.isInteger(v) ? v : 0;
}
