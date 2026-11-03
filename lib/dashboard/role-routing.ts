import { UserRole } from "@/lib/auth/permissions";

/**
 * Authoritative role -> dashboard home path.
 *
 * The authoritative role is User.role from PostgreSQL. A BoosterProfile
 * (existent or PENDING) never promotes a CUSTOMER to BOOSTER.
 */
export function getRoleHomePath(role: UserRole): string {
  switch (role) {
    case "ADMIN":
      return "/dashboard/admin";
    case "BOOSTER":
      return "/dashboard/booster";
    case "CUSTOMER":
    default:
      return "/dashboard/customer";
  }
}

export type RedirectDiagnostic = {
  from: string;
  to: string;
  databaseRole: string | null | undefined;
  boosterStatus: string | null | undefined;
  reason: string;
};

/**
 * Temporary development-only structured diagnostics for dashboard redirects.
 * Never logs passwords, hashes, session cookies, OAuth tokens or credentials.
 */
export function devLogRedirect(diagnostic: RedirectDiagnostic): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  console.info("[DASHBOARD_REDIRECT]", {
    ...diagnostic,
    ts: new Date().toISOString(),
  });
}
