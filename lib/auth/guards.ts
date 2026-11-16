import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import prisma from "@/lib/prisma";
import { sessionVersionOf } from "@/lib/auth/session-version";
import { UserRole } from "@/types/next-auth";
import { hasRole } from "./permissions";
import { hasBoosterAccess } from "@/lib/boosters/status";

export interface SessionUser {
  id: string;
  email: string | null;
  role: UserRole;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id, deletedAt: null, sessionVersion: sessionVersionOf(session) },
    select: {
      id: true,
      email: true,
      role: true,
      boosterProfile: {
        select: { verificationStatus: true },
      },
    },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: (user.role ?? "CUSTOMER") as UserRole,
  };
}

/**
 * Canonical account-state gate for privileged realtime/auth flows.
 * Uses existing persisted fields only: deleted users fail DB lookup; boosters
 * must have an APPROVED booster profile (PENDING/REJECTED/SUSPENDED are not
 * eligible for booster-scoped realtime access). No client-supplied identity.
 */
export async function getRealtimeEligibleUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id, deletedAt: null, sessionVersion: sessionVersionOf(session) },
    select: {
      id: true,
      email: true,
      role: true,
      boosterProfile: {
        select: { verificationStatus: true },
      },
    },
  });

  if (!user) {
    return null;
  }

  const role = (user.role ?? "CUSTOMER") as UserRole;
  if (role === "BOOSTER") {
    if (!user.boosterProfile || !hasBoosterAccess(user.boosterProfile.verificationStatus)) {
      return null;
    }
  }

  return {
    id: user.id,
    email: user.email,
    role,
  };
}

export async function requireAuth() {
  const user = await getSessionUser();
  if (!user) {
    throw new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  return user;
}

export async function requireRole(role: UserRole) {
  const user = await requireAuth();
  if (user.role !== role) {
    throw new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return user;
}

export async function requireAnyRole(roles: UserRole[]) {
  const user = await requireAuth();
  if (!hasRole(user.role, roles)) {
    throw new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return user;
}

export async function requireCustomer() {
  return requireAnyRole(["CUSTOMER"]);
}

export async function requireBooster() {
  return requireAnyRole(["BOOSTER"]);
}

export async function requireAdmin() {
  return requireAnyRole(["ADMIN"]);
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
