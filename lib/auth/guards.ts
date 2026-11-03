import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import prisma from "@/lib/prisma";
import { UserRole } from "@/types/next-auth";
import { hasRole } from "./permissions";

export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  if (!user) {
    return null;
  }

  return {
    ...user,
    role: (user.role ?? "CUSTOMER") as UserRole,
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
