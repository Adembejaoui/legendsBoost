export type UserRole = "ADMIN" | "BOOSTER" | "CUSTOMER";

export const ROLES = {
  ADMIN: "ADMIN",
  BOOSTER: "BOOSTER",
  CUSTOMER: "CUSTOMER",
} as const;

export function isAdmin(role: string | null | undefined): boolean {
  return role === ROLES.ADMIN;
}

export function isBooster(role: string | null | undefined): boolean {
  return role === ROLES.BOOSTER;
}

export function isCustomer(role: string | null | undefined): boolean {
  return role === ROLES.CUSTOMER;
}

export function hasRole(
  role: string | null | undefined,
  allowed: UserRole | UserRole[]
): boolean {
  if (!role) {
    return false;
  }
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed];
  return allowedRoles.includes(role as UserRole);
}
