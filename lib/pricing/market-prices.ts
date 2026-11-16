/**
 * MARKET DEFAULT prices (USD), chosen from competitor ranges researched on
 * 2026-11-14 (GameBoost, Boosteria, Eloking, BoostRoyal; see
 * reports/Game boosting competitor features.md). They replace the flat
 * TEMPORARY test prices and are applied through the normal admin path by
 * scripts/apply-market-prices.ts (new ServicePrice version + audit row).
 * After that, Admin > Finance > Pricing is the place to change them.
 *
 * Like temporary-prices.ts, this module is never read by the running app:
 * the server always prices from the stored ServicePrice row.
 *
 *  - Rank boosts: RANK_STEPS, price per division step by the tier the step
 *    starts in (Diamond steps cost more than Iron steps). Current LP and LP
 *    gain then adjust it (lib/pricing/lp-modifiers.ts).
 *  - Win boosts / placements: PER_UNIT (per win / per match).
 *  - Champion mastery: FIXED.
 *  - Extras: the percentage on the catalog badge ("+25%") becomes the real
 *    surcharge; "Free" / "Auto" extras are included at 0. Duo mode +40%.
 *  - Arena, Normal Matches, VALORANT Unrated: deliberately left unpriced.
 */
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import type { PriceAdjustment, ServicePriceInput } from "./price-config";

export const MARKET_PRICE_CURRENCY = "USD";
export const MARKET_PRICE_NOTE = "Market default prices (competitor research 2026-11-14)";

/** Duo (playing together) costs more than solo, as on competitor sites. */
export const DUO_MODE_BPS = 4000;

type Spec =
  | { model: "RANK_STEPS"; stepAmounts: Record<string, number> }
  | { model: "PER_UNIT"; unitFieldKey: string; unitAmount: number }
  | { model: "FIXED"; baseAmount: number };

const LOL_STEPS = { iron: 600, bronze: 700, silver: 900, gold: 1200, platinum: 1600, emerald: 2200, diamond: 3800, master: 0 };
const TFT_STEPS = { iron: 500, bronze: 600, silver: 800, gold: 1000, platinum: 1400, emerald: 1900, diamond: 3200, master: 0 };
const TFT_DOUBLE_UP_STEPS = { iron: 450, bronze: 550, silver: 700, gold: 900, platinum: 1250, emerald: 1700, diamond: 2900, master: 0 };
const VALORANT_STEPS = { iron: 600, bronze: 700, silver: 900, gold: 1200, platinum: 1600, diamond: 2400, ascendant: 3600, immortal: 6000, radiant: 0 };

/** Amounts in USD cents. A service missing here stays unpriced. */
export const MARKET_PRICE_SPECS: Record<string, Spec> = {
  "league-of-legends:rank-boost": { model: "RANK_STEPS", stepAmounts: LOL_STEPS },
  "league-of-legends:win-boost": { model: "PER_UNIT", unitFieldKey: "wins", unitAmount: 450 },
  "league-of-legends:placement-boost": { model: "PER_UNIT", unitFieldKey: "placementsRemaining", unitAmount: 400 },
  "league-of-legends:champion-mastery": { model: "FIXED", baseAmount: 1500 },
  "valorant:rank-boost": { model: "RANK_STEPS", stepAmounts: VALORANT_STEPS },
  "valorant:win-boost": { model: "PER_UNIT", unitFieldKey: "wins", unitAmount: 500 },
  "valorant:placement-boost": { model: "PER_UNIT", unitFieldKey: "placementsRemaining", unitAmount: 450 },
  "teamfight-tactics:rank-boost": { model: "RANK_STEPS", stepAmounts: TFT_STEPS },
  "teamfight-tactics:win-boost": { model: "PER_UNIT", unitFieldKey: "wins", unitAmount: 600 },
  "teamfight-tactics:placement-boost": { model: "PER_UNIT", unitFieldKey: "placementsRemaining", unitAmount: 450 },
  "teamfight-tactics:double-up-boost": { model: "RANK_STEPS", stepAmounts: TFT_DOUBLE_UP_STEPS },
};

/** "+25%" -> 2500 bps; "Free" / "Auto" / no badge -> included (0). */
export function badgeToAdjustment(badge: string | undefined): PriceAdjustment {
  const m = badge?.trim().match(/^\+(\d{1,3}(?:\.\d{1,2})?)%$/);
  if (m) return { type: "bps", bps: Math.round(Number(m[1]) * 100) };
  return { type: "fixed", amount: 0 };
}

export function buildMarketPriceInput(gameSlug: string, serviceSlug: string): ServicePriceInput | null {
  const spec = MARKET_PRICE_SPECS[`${gameSlug}:${serviceSlug}`];
  const offer = gameServices.find((o) => o.gameSlug === gameSlug && o.serviceSlug === serviceSlug);
  if (!spec || !offer) return null;
  const checkout = getCheckoutConfig(gameSlug, serviceSlug);
  const input: ServicePriceInput = {
    gameSlug,
    serviceSlug,
    currency: MARKET_PRICE_CURRENCY,
    pricingModel: spec.model,
    baseAmount: spec.model === "FIXED" ? spec.baseAmount : 0,
    optionPricing: Object.fromEntries(
      (checkout?.options ?? []).filter((o) => o.enabled).map((o) => [o.id, badgeToAdjustment(o.badge)])
    ),
    modePricing: Object.fromEntries(
      (checkout?.modes ?? [])
        .filter((m) => m.enabled)
        .map((m) => [m.id, m.id === "duo" ? { type: "bps" as const, bps: DUO_MODE_BPS } : { type: "fixed" as const, amount: 0 }])
    ),
    note: MARKET_PRICE_NOTE,
  };
  if (spec.model === "RANK_STEPS") {
    // Only tiers of this service's rank system (validation rejects others).
    const tiers = new Set((getRankSystem(offer.rankSystemId ?? "")?.tiers ?? []).map((t) => t.id));
    input.stepAmounts = Object.fromEntries(Object.entries(spec.stepAmounts).filter(([t]) => tiers.has(t)));
  }
  if (spec.model === "PER_UNIT") {
    input.unitFieldKey = spec.unitFieldKey;
    input.unitAmount = spec.unitAmount;
  }
  return input;
}

export function allMarketPriceInputs(): ServicePriceInput[] {
  return gameServices
    .map((o) => buildMarketPriceInput(o.gameSlug, o.serviceSlug))
    .filter((x): x is ServicePriceInput => x !== null);
}
