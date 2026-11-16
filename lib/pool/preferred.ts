// Server-only module.
/**
 * Preferred booster (decision 2026-11-15): at checkout the customer may pick
 * a booster by public display name. After payment that booster alone sees
 * the order for `preferred_booster_window_min` (30) and can claim it at the
 * full payout; then it joins the normal pool.
 *
 * Only active boosters (APPROVED) with a display name who are allowed to do
 * the order (game, service, rank ceiling) are offered. Ids and display names
 * are the only booster data a customer sees.
 */
import prisma from "@/lib/prisma";
import { eligibilityProblem, type OrderLike, type PermissionLike } from "./eligibility";

export interface PreferableBooster {
  id: string;
  displayName: string;
}

async function activeBoostersWithNames() {
  return prisma.boosterProfile.findMany({
    where: { verificationStatus: "APPROVED", displayName: { not: null }, user: { role: "BOOSTER" } },
    select: { userId: true, displayName: true, permissions: true },
    orderBy: { displayName: "asc" },
    take: 200,
  });
}

/** Boosters a customer may choose for this order (region unknown at checkout). */
export async function listPreferableBoosters(order: Omit<OrderLike, "region">): Promise<PreferableBooster[]> {
  const boosters = await activeBoostersWithNames();
  return boosters
    .filter((b) => eligibilityProblem(b.permissions as PermissionLike[], { ...order, region: null }) === null)
    .map((b) => ({ id: b.userId, displayName: b.displayName! }));
}

/** Throws a user-facing message when the chosen booster cannot take the order. */
export async function assertPreferable(boosterId: string, order: Omit<OrderLike, "region">): Promise<void> {
  const b = await prisma.boosterProfile.findUnique({
    where: { userId: boosterId },
    select: { verificationStatus: true, displayName: true, permissions: true, user: { select: { role: true } } },
  });
  if (!b || b.user.role !== "BOOSTER" || b.verificationStatus !== "APPROVED" || !b.displayName) {
    throw new Error("The booster you chose is not available. Pick another one or let any booster take it.");
  }
  if (eligibilityProblem(b.permissions as PermissionLike[], { ...order, region: null }) !== null) {
    throw new Error("The booster you chose cannot take this order. Pick another one or let any booster take it.");
  }
}

/** Display name rules (booster profile). */
export const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_.-]{3,20}$/;
