/**
 * Which orders a booster may see and take [registry F9, F24].
 *
 * Pure functions: the pool query, bids, claim now and award all call
 * `eligibilityProblem` with the booster's permissions, so a booster can never
 * take (or even see) an order above their rank ceiling, in a region or a
 * service they are not allowed.
 */
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { rankValue } from "@/lib/domain/rank";

export interface PermissionLike {
  gameSlug: string;
  rankSystemId: string;
  maxTargetRankValue: number;
  regions: string[];
  serviceSlugs: string[];
}

export interface OrderLike {
  gameSlug: string;
  serviceSlug: string;
  configuration: unknown;
  /** Riot platform of the customer's account (EUW1...), when known. */
  region?: string | null;
}

export type EligibilityProblem = "NO_GAME_PERMISSION" | "ABOVE_RANK_CEILING" | "REGION_NOT_ALLOWED" | "SERVICE_NOT_ALLOWED";

export const ELIGIBILITY_MESSAGE: Record<EligibilityProblem, string> = {
  NO_GAME_PERMISSION: "You are not approved for this game.",
  ABOVE_RANK_CEILING: "This order is above your rank ceiling.",
  REGION_NOT_ALLOWED: "You are not approved for this region.",
  SERVICE_NOT_ALLOWED: "You are not approved for this service.",
};

/**
 * The rank an order needs, per rank system: the highest rank field in the
 * order (target rank for a rank boost, current rank for wins / placements).
 * Null when the service has no rank (normal matches, mastery, arena).
 */
export function orderRankRequirement(order: Pick<OrderLike, "gameSlug" | "serviceSlug" | "configuration">): { rankSystemId: string; value: number } | null {
  const offer = getGameServiceOffer(order.gameSlug, order.serviceSlug);
  const config = (order.configuration && typeof order.configuration === "object" ? order.configuration : {}) as Record<string, unknown>;
  let best: { rankSystemId: string; value: number } | null = null;
  for (const field of offer?.fields ?? []) {
    if (field.type !== "rank-picker" || !("rankSystemId" in field) || !field.rankSystemId) continue;
    const sel = config[field.key] as { tierId?: unknown; divisionId?: unknown } | undefined;
    if (!sel || typeof sel.tierId !== "string") continue;
    const value = rankValue(field.rankSystemId, { tierId: sel.tierId, divisionId: typeof sel.divisionId === "string" ? sel.divisionId : null });
    if (value === null) continue;
    if (!best || value > best.value) best = { rankSystemId: field.rankSystemId, value };
  }
  return best;
}

/** Null when the booster may take the order, otherwise the first problem. */
export function eligibilityProblem(permissions: readonly PermissionLike[], order: OrderLike): EligibilityProblem | null {
  const perm = permissions.find((p) => p.gameSlug === order.gameSlug);
  if (!perm) return "NO_GAME_PERMISSION";
  if (perm.serviceSlugs.length > 0 && !perm.serviceSlugs.includes(order.serviceSlug)) return "SERVICE_NOT_ALLOWED";
  const region = order.region?.trim().toUpperCase();
  if (region && perm.regions.length > 0 && !perm.regions.includes(region)) return "REGION_NOT_ALLOWED";
  const need = orderRankRequirement(order);
  // Ceilings are kept on the game's main ladder. A rank on another ladder
  // (e.g. TFT Double Up) is compared on the same scale only when it is the
  // same rank system; otherwise the game permission alone applies.
  if (need && need.rankSystemId === perm.rankSystemId && need.value > perm.maxTargetRankValue) return "ABOVE_RANK_CEILING";
  return null;
}

/** Payout amounts derived from the ceiling (minor units). */
export function payoutAmounts(ceiling: number, cfg: { claimNowDiscountBps: number; minBidBps: number }) {
  return {
    ceiling,
    claimNow: Math.floor((ceiling * (10_000 - cfg.claimNowDiscountBps)) / 10_000),
    minBid: Math.min(ceiling, Math.ceil((ceiling * cfg.minBidBps) / 10_000)),
  };
}
