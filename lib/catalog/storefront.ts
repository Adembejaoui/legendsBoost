/**
 * Server-side storefront data for steps 1-2 of the checkout: per service,
 * whether it can be bought right now and its starting price.
 *
 * "Orderable" = catalog eligibility (getOrderEligibility, incl. the Stripe
 * mode rule) AND an active admin price. The starting price is computed by
 * the real pricing engine on the cheapest valid configuration, so the
 * "From $X" badge can never disagree with what the quote API returns for
 * that configuration. Read-only.
 */
import prisma from "@/lib/prisma";
import { gameServices, getGameServiceOffers } from "@/lib/catalog/game-services";
import { getCheckoutConfig, type GameCheckoutConfig } from "@/lib/config/checkout-options";
import { champions } from "@/lib/catalog/champions";
import { getOrderEligibility } from "@/lib/orders/order-eligibility";
import { calculateQuote, rankLadder } from "@/lib/pricing/engine";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { parseServicePriceRow, type ServicePriceConfig } from "@/lib/pricing/price-config";
import { getActiveCommissionPolicy } from "@/lib/pricing/service";
import { logger } from "@/lib/logger";
import type { GameServiceOffer } from "@/types/catalog";

import type { StorefrontService } from "./storefront-types";
export type { ServiceAvailability, StorefrontService } from "./storefront-types";
export { AVAILABILITY_LABEL } from "./storefront-types";

/** Cheapest valid configuration for each enabled mode (no extras). */
function cheapestRequests(offer: GameServiceOffer, checkout: GameCheckoutConfig) {
  const configuration: Record<string, unknown> = {};
  for (const f of offer.fields) {
    if (!f.required) continue;
    if (f.type === "rank-picker") {
      const ladder = rankLadder(f.rankSystemId);
      configuration[f.key] = ladder[f.key === "targetRank" ? 1 : 0];
    } else if (f.type === "number") configuration[f.key] = f.min ?? 1;
    else if (f.type === "select") configuration[f.key] = f.options[0]?.value;
    else if (f.type === "multi-select") configuration[f.key] = f.options[0] ? [f.options[0].value] : [];
    else if (f.type === "champion-picker") configuration[f.key] = champions[0]?.id;
    else if (f.type === "checkbox") configuration[f.key] = false;
  }
  const modes = (checkout.modes ?? []).filter((m) => m.enabled).map((m) => m.id);
  return (modes.length ? modes : [undefined]).map((selectedMode) => ({
    gameSlug: offer.gameSlug,
    serviceSlug: offer.serviceSlug,
    configuration,
    selectedMode,
    selectedOptions: [] as string[],
  }));
}

/** Pure: lowest server price over the cheapest configurations, or null. */
export function computeStartingPrice(
  offer: GameServiceOffer,
  checkout: GameCheckoutConfig,
  price: ServicePriceConfig,
  policy: { id: string; platformFeeBps: number; boosterShareBps: number }
): { amount: number; currency: string } | null {
  let best: { amount: number; currency: string } | null = null;
  for (const request of cheapestRequests(offer, checkout)) {
    const v = validateOrderInput(offer, checkout, request);
    if (!v.ok) continue;
    const q = calculateQuote(offer, checkout, price, policy, v.value);
    if (q.ok && (!best || q.quote.totalAmount < best.amount)) best = { amount: q.quote.totalAmount, currency: q.quote.currency };
  }
  return best;
}

async function loadPricing(gameSlug?: string) {
  try {
    const [rows, policy] = await Promise.all([
      prisma.servicePrice.findMany({ where: { status: "ACTIVE", ...(gameSlug ? { gameSlug } : {}) } }),
      getActiveCommissionPolicy(),
    ]);
    const prices = new Map<string, ServicePriceConfig>();
    for (const r of rows) {
      const p = parseServicePriceRow(r);
      if (p) prices.set(`${r.gameSlug}:${r.serviceSlug}`, p);
    }
    return { prices, policy };
  } catch (e) {
    // The storefront still renders without prices; the quote API stays authoritative.
    logger.error("Storefront pricing unavailable", { error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}

function describe(offer: GameServiceOffer, pricing: Awaited<ReturnType<typeof loadPricing>>): StorefrontService {
  const eligible = getOrderEligibility(offer.gameSlug, offer.serviceSlug).ok;
  if (!eligible) return { serviceSlug: offer.serviceSlug, availability: "unavailable", startingPrice: null };
  if (!pricing) return { serviceSlug: offer.serviceSlug, availability: "unknown", startingPrice: null };
  const price = pricing.prices.get(`${offer.gameSlug}:${offer.serviceSlug}`);
  const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug);
  if (!price || !pricing.policy || !checkout) return { serviceSlug: offer.serviceSlug, availability: "unpriced", startingPrice: null };
  return { serviceSlug: offer.serviceSlug, availability: "available", startingPrice: computeStartingPrice(offer, checkout, price, pricing.policy) };
}

export async function getStorefrontServices(gameSlug: string): Promise<StorefrontService[]> {
  const pricing = await loadPricing(gameSlug);
  return getGameServiceOffers(gameSlug).map((o) => describe(o, pricing));
}

export async function getStorefrontService(gameSlug: string, serviceSlug: string): Promise<StorefrontService | null> {
  const offer = gameServices.find((o) => o.gameSlug === gameSlug && o.serviceSlug === serviceSlug);
  if (!offer) return null;
  return describe(offer, await loadPricing(gameSlug));
}

/** Step 1: number of services that can be bought right now, per game. */
export async function getAvailableServiceCounts(): Promise<Record<string, number | null>> {
  const pricing = await loadPricing();
  const counts: Record<string, number | null> = {};
  for (const o of gameServices) {
    const d = describe(o, pricing);
    if (d.availability === "unknown") counts[o.gameSlug] = null;
    else if (counts[o.gameSlug] !== null) counts[o.gameSlug] = (counts[o.gameSlug] ?? 0) + (d.availability === "available" ? 1 : 0);
  }
  return counts;
}
