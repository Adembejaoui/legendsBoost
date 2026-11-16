/**
 * Customer-facing price tags for extras and modes ("+25%", "+$5.00",
 * "Free"), derived from the ACTIVE admin price so the badge a customer sees
 * is always what the server will charge. Replaces the static badges in
 * lib/config/checkout-options.ts, which could disagree with the real price.
 */
import { formatMoney } from "@/lib/money";
import type { PriceAdjustment } from "./price-config";
import { getActiveServicePrice } from "./service";

export interface PriceTags {
  currency: string;
  /** Option id -> tag. An option missing here has no price and cannot be bought. */
  options: Record<string, string>;
  /** Mode id -> tag ("" for an included mode). */
  modes: Record<string, string>;
}

export function priceTag(adj: PriceAdjustment, currency: string): string {
  if (adj.type === "bps") {
    if (adj.bps === 0) return "Free";
    const pct = adj.bps / 100;
    return `+${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
  }
  return adj.amount === 0 ? "Free" : `+${formatMoney(adj.amount, currency)}`;
}

export async function getPriceTags(gameSlug: string, serviceSlug: string): Promise<PriceTags | null> {
  const price = await getActiveServicePrice(gameSlug, serviceSlug).catch(() => null);
  if (!price) return null;
  const tag = (a: PriceAdjustment) => priceTag(a, price.currency);
  return {
    currency: price.currency,
    options: Object.fromEntries(Object.entries(price.optionPricing).map(([k, v]) => [k, tag(v)])),
    modes: Object.fromEntries(
      Object.entries(price.modePricing).map(([k, v]) => [k, tag(v) === "Free" ? "" : tag(v)])
    ),
  };
}
