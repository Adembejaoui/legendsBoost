/**
 * Customer-facing summary of a paid order: what was bought and what was paid.
 * Shared by the checkout success page and the "Order confirmed" email, so
 * both always show the same thing. Labels come from the catalog; nothing is
 * invented and no internal field (commission, payment ids) is included.
 */
import { getGame } from "@/lib/catalog/games";
import { getServiceTemplate } from "@/lib/catalog/service-templates";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getTier, formatRankLabel } from "@/lib/catalog/rank-systems";
import { getCheckoutConfig } from "@/lib/config/checkout-options";

export interface OrderSummaryRank {
  label: string;
  iconSrc: string | null;
}

export interface OrderSummary {
  reference: string;
  gameSlug: string;
  gameName: string;
  gameImage: string | null;
  serviceName: string;
  /** Rank boosts: from → to. */
  ranks: { from: OrderSummaryRank | null; to: OrderSummaryRank | null } | null;
  /** Other configuration fields (wins, games, region…). */
  details: { label: string; value: string }[];
  mode: string | null;
  options: string[];
  pricing: {
    currency: string;
    lines: { label: string; amount: number }[];
    discountAmount: number;
    totalAmount: number;
  } | null;
}

type SnapshotLike = {
  currency: string;
  discountAmount: number;
  totalAmount: number;
  breakdown: unknown;
} | null;

export function orderReference(orderId: string): string {
  return orderId.slice(-8).toUpperCase();
}

const RANK_KEYS = new Set(["currentRank", "targetRank"]);

function rankOf(rankSystemId: string, value: unknown): OrderSummaryRank | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { tierId?: unknown; divisionId?: unknown };
  if (typeof v.tierId !== "string") return null;
  const tier = getTier(rankSystemId, v.tierId);
  if (!tier) return null;
  const divisionId = typeof v.divisionId === "string" ? v.divisionId : null;
  return { label: formatRankLabel(rankSystemId, { tierId: v.tierId, divisionId }), iconSrc: tier.iconSrc ?? null };
}

function valueOf(value: unknown, rankSystemId: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object" && "tierId" in (value as object)) return rankOf(rankSystemId, value)?.label ?? null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

export function buildOrderSummary(order: {
  id: string;
  gameSlug: string;
  serviceSlug: string;
  configuration: unknown;
  selectedMode: string | null;
  selectedOptions: string[];
  pricingSnapshot?: SnapshotLike;
}): OrderSummary {
  const game = getGame(order.gameSlug);
  const template = getServiceTemplate(order.serviceSlug);
  const offer = getGameServiceOffer(order.gameSlug, order.serviceSlug);
  const cfg = (order.configuration ?? {}) as Record<string, unknown>;
  const fallbackSystem = offer?.rankSystemId ?? "lol-ranked";
  const systemOf = (field: object) => ("rankSystemId" in field && typeof field.rankSystemId === "string" ? field.rankSystemId : fallbackSystem);

  let from: OrderSummaryRank | null = null;
  let to: OrderSummaryRank | null = null;
  const details: OrderSummary["details"] = [];
  for (const field of offer?.fields ?? []) {
    if (field.key === "currentRank") from = rankOf(systemOf(field), cfg[field.key]);
    else if (field.key === "targetRank") to = rankOf(systemOf(field), cfg[field.key]);
    if (RANK_KEYS.has(field.key)) continue;
    const v = valueOf(cfg[field.key], systemOf(field));
    if (v) details.push({ label: field.label, value: v });
  }

  const checkout = getCheckoutConfig(order.gameSlug, order.serviceSlug);
  const options = order.selectedOptions.map((id) => checkout?.options.find((o) => o.id === id)?.label ?? id);
  const mode = order.selectedMode ? checkout?.modes?.find((m) => m.id === order.selectedMode)?.label ?? order.selectedMode : null;

  const s = order.pricingSnapshot ?? null;
  const lines = ((s?.breakdown as { lines?: { label?: unknown; amount?: unknown }[] } | null)?.lines ?? [])
    .filter((l) => typeof l.label === "string" && typeof l.amount === "number")
    .map((l) => ({ label: l.label as string, amount: l.amount as number }));

  return {
    reference: orderReference(order.id),
    gameSlug: order.gameSlug,
    gameName: game?.name ?? order.gameSlug,
    gameImage: game?.image ?? null,
    serviceName: template?.title ?? order.serviceSlug,
    ranks: from || to ? { from, to } : null,
    details,
    mode,
    options,
    pricing: s ? { currency: s.currency, lines, discountAmount: s.discountAmount, totalAmount: s.totalAmount } : null,
  };
}
