// Server-only module.
/**
 * Admin actions on boosters, shared by the API routes: status changes
 * (through transitionBooster), permissions/ceilings, mock KYC decisions.
 */
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { BoosterTransitionError, transitionBooster } from "./transitions";
import { PermissionError, removePermissionByAdmin, setPermissionByAdmin } from "./permissions";
import type { BoosterStatus } from "./status";
import { getKycProvider } from "@/lib/providers/kyc";

async function profileFor(userId: string) {
  const profile = await prisma.boosterProfile.findUnique({ where: { userId }, select: { id: true, verificationStatus: true } });
  if (!profile) throw new BoosterTransitionError("Booster profile not found", 404);
  return profile;
}

export async function adminChangeBoosterStatus(
  adminId: string,
  userId: string,
  to: BoosterStatus,
  note?: string | null,
  expectedFrom?: BoosterStatus
) {
  if (adminId === userId) throw new BoosterTransitionError("You cannot review your own booster account.", 403);
  const profile = await profileFor(userId);
  return prisma.$transaction((tx) =>
    transitionBooster(tx, { profileId: profile.id, to, actorId: adminId, actor: "admin", note, expectedFrom })
  );
}

export async function adminSetPermission(adminId: string, userId: string, raw: unknown) {
  const profile = await profileFor(userId);
  return prisma.$transaction((tx) => setPermissionByAdmin(tx, adminId, profile.id, raw));
}

export async function adminRemovePermission(adminId: string, userId: string, gameSlug: string) {
  const profile = await profileFor(userId);
  return prisma.$transaction((tx) => removePermissionByAdmin(tx, adminId, profile.id, gameSlug));
}

/** Mock KYC: the admin records the outcome (a real provider will do this in Phase 10). */
export async function adminSetKyc(adminId: string, userId: string, status: "VERIFIED" | "REJECTED" | "NOT_STARTED") {
  const profile = await profileFor(userId);
  return prisma.$transaction(async (tx) => {
    const before = await tx.boosterProfile.findUniqueOrThrow({ where: { id: profile.id }, select: { kycStatus: true } });
    const updated = await tx.boosterProfile.update({ where: { id: profile.id }, data: { kycStatus: status } });
    await tx.boosterEvent.create({
      data: { boosterProfileId: profile.id, type: "KYC_CHANGED", fromStatus: before.kycStatus, toStatus: status, actorId: adminId },
    });
    await audit({ actorId: adminId, action: "BOOSTER_KYC_SET", entityType: "boosterProfile", entityId: profile.id, metadata: { from: before.kycStatus, to: status } }, tx);
    return updated;
  });
}

/** Booster starts identity verification (mock provider: goes to PENDING). */
export async function startKyc(boosterUserId: string) {
  const profile = await profileFor(boosterUserId);
  const current = await prisma.boosterProfile.findUniqueOrThrow({ where: { id: profile.id }, select: { kycStatus: true } });
  if (current.kycStatus === "VERIFIED" || current.kycStatus === "PENDING") return current;
  const session = await getKycProvider().startVerification(boosterUserId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.boosterProfile.update({ where: { id: profile.id }, data: { kycStatus: "PENDING", kycReference: session.reference } });
    await tx.boosterEvent.create({
      data: { boosterProfileId: profile.id, type: "KYC_STARTED", fromStatus: current.kycStatus, toStatus: "PENDING", actorId: boosterUserId, metadata: { provider: session.provider } },
    });
    return updated;
  });
}

/** Map domain errors to HTTP responses. */
export function boosterErrorResponse(e: unknown) {
  if (e instanceof BoosterTransitionError || e instanceof PermissionError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if ((e as { code?: string })?.code === "P2025") {
    return NextResponse.json({ error: "This booster changed in the meantime. Reload and try again." }, { status: 409 });
  }
  if (e instanceof Response) return e;
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
}
