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
import { cachedCatalog } from "./price-cache";
import { parseRangeKey } from "@/lib/pricing/units";
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
  // A range price (e.g. mastery Level 1 -> 2) needs the "to" field one step above "from".
  const range = price.unitFieldKey ? parseRangeKey(price.unitFieldKey) : null;
  for (const request of cheapestRequests(offer, checkout)) {
    if (range && typeof request.configuration[range.from] === "number") {
      request.configuration = { ...request.configuration, [range.to]: (request.configuration[range.from] as number) + 1 };
    }
    const v = validateOrderInput(offer, checkout, request);
    if (!v.ok) continue;
    const q = calculateQuote(offer, checkout, price, policy, v.value);
    if (q.ok && (!best || q.quote.totalAmount < best.amount)) best = { amount: q.quote.totalAmount, currency: q.quote.currency };
  }
  return best;
}

/** Active prices and commission; throws when the database is unreachable. */
async function loadPricingStrict(gameSlug?: string) {
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
}

async function loadPricing(gameSlug?: string) {
  try {
    return await loadPricingStrict(gameSlug);
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

async function storefrontServices(gameSlug: string, strict: boolean): Promise<StorefrontService[]> {
  const pricing = strict ? await loadPricingStrict(gameSlug) : await loadPricing(gameSlug);
  return getGameServiceOffers(gameSlug).map((o) => describe(o, pricing));
}

async function storefrontService(gameSlug: string, serviceSlug: string, strict: boolean): Promise<StorefrontService | null> {
  const offer = gameServices.find((o) => o.gameSlug === gameSlug && o.serviceSlug === serviceSlug);
  if (!offer) return null;
  return describe(offer, strict ? await loadPricingStrict(gameSlug) : await loadPricing(gameSlug));
}

/** Services of a game with their starting price (cached 60 s, see price-cache.ts). */
export const getStorefrontServices = cachedCatalog(
  "services",
  (gameSlug: string) => storefrontServices(gameSlug, true),
  (gameSlug: string) => storefrontServices(gameSlug, false)
);

/** One service with its starting price (cached 60 s). */
export const getStorefrontService = cachedCatalog(
  "service",
  (gameSlug: string, serviceSlug: string) => storefrontService(gameSlug, serviceSlug, true),
  (gameSlug: string, serviceSlug: string) => storefrontService(gameSlug, serviceSlug, false)
);

/** Step 1: number of services that can be bought right now, per game (cached 60 s). */
export const getAvailableServiceCounts = cachedCatalog(
  "counts",
  () => availableServiceCounts(true),
  () => availableServiceCounts(false)
);

async function availableServiceCounts(strict: boolean): Promise<Record<string, number | null>> {
  const pricing = strict ? await loadPricingStrict() : await loadPricing();
  const counts: Record<string, number | null> = {};
  for (const o of gameServices) {
    const d = describe(o, pricing);
    if (d.availability === "unknown") counts[o.gameSlug] = null;
    else if (counts[o.gameSlug] !== null) counts[o.gameSlug] = (counts[o.gameSlug] ?? 0) + (d.availability === "available" ? 1 : 0);
  }
  return counts;
}
