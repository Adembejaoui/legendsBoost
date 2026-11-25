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
 *    surcharge; "Free" / "Auto" extras are included at 0. Duo mode +50% (2026-11-19).
 *  - VALORANT Unrated and TFT Double Up: not set here (priced in the admin).
 *  - Updated 2026-11-25 to match gameboost.com (see the note above the tables).
 */
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import type { PriceAdjustment, ServicePriceInput } from "./price-config";

export const MARKET_PRICE_CURRENCY = "USD";
export const MARKET_PRICE_NOTE = "Market default prices (competitor research 2026-11-14)";

/** Duo (playing together) costs more than solo, as on competitor sites. */
export const DUO_MODE_BPS = 5000;

type Spec =
  | { model: "RANK_STEPS"; stepAmounts: Record<string, number> }
  | { model: "PER_UNIT"; unitFieldKey: string; unitAmount: number; unitAmounts?: Record<string, number> }
  | { model: "FIXED"; baseAmount: number };

/*
 * Matched to gameboost.com on 2026-11-25 (client request), list prices before
 * their automatic 5-15% discount. Rank steps = their full-tier price / number
 * of divisions (IV -> next IV). Wins: their 3-win price / 3 at each tier.
 * Placements, Arena and Normal Games: their default setup / count.
 * Champion Mastery: their price per level up to Level 7; 7 -> 10 (not sold
 * there) uses the 6 -> 7 price. VALORANT Immortal and the services they do
 * not sell (TFT wins/placements, VALORANT placements) keep our earlier price.
 */
const LOL_STEPS = { iron: 492, bronze: 597, silver: 758, gold: 1093, platinum: 1722, emerald: 2496, diamond: 5519, master: 0 };
const LOL_WIN = { iron: 115, bronze: 124, silver: 240, gold: 387, platinum: 562, emerald: 610, diamond: 1338, master: 2554 };
const MASTERY_LEVEL = { "1": 517, "2": 1046, "3": 1664, "4": 4120, "5": 1969, "6": 1045, "7": 1045, "8": 1045, "9": 1045 };
const TFT_STEPS = { iron: 294, bronze: 359, silver: 408, gold: 837, platinum: 1258, emerald: 1903, diamond: 2434, master: 0 };
const TFT_DOUBLE_UP_STEPS = { iron: 450, bronze: 550, silver: 700, gold: 900, platinum: 1250, emerald: 1700, diamond: 2900, master: 0 };
const VALORANT_STEPS = { iron: 492, bronze: 507, silver: 695, gold: 906, platinum: 1268, diamond: 2775, ascendant: 5204, immortal: 6000, radiant: 0 };
const VALORANT_WIN = { iron: 300, bronze: 335, silver: 389, gold: 516, platinum: 799, diamond: 1222, ascendant: 1455, immortal: 2039 };

/** Amounts in USD cents. A service missing here stays unpriced. */
export const MARKET_PRICE_SPECS: Record<string, Spec> = {
  "league-of-legends:rank-boost": { model: "RANK_STEPS", stepAmounts: LOL_STEPS },
  "league-of-legends:win-boost": { model: "PER_UNIT", unitFieldKey: "wins", unitAmount: 115, unitAmounts: LOL_WIN },
  "league-of-legends:placement-boost": { model: "PER_UNIT", unitFieldKey: "placementsRemaining", unitAmount: 210 },
  // Price per mastery level gained, by the level it starts at (Level 4 -> 6 = 4->5 + 5->6).
  "league-of-legends:champion-mastery": { model: "PER_UNIT", unitFieldKey: "range:currentLevel:targetLevel", unitAmount: 1045, unitAmounts: MASTERY_LEVEL },
  "league-of-legends:arena-boost": { model: "PER_UNIT", unitFieldKey: "arenaWins", unitAmount: 269 },
  // Per game; Wins cost +50% (lib/pricing/count-type.ts).
  "league-of-legends:normal-matches": { model: "PER_UNIT", unitFieldKey: "matches", unitAmount: 272 },
  "valorant:rank-boost": { model: "RANK_STEPS", stepAmounts: VALORANT_STEPS },
  "valorant:win-boost": { model: "PER_UNIT", unitFieldKey: "wins", unitAmount: 300, unitAmounts: VALORANT_WIN },
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
    if (spec.unitAmounts) input.stepAmounts = spec.unitAmounts;
  }
  // Extras matched to gameboost.com (2026-11-25), over the catalog badge.
  const overrides = OPTION_BPS_OVERRIDES[`${gameSlug}:${serviceSlug}`] ?? {};
  for (const [id, bps] of Object.entries(overrides)) if (id in input.optionPricing) input.optionPricing[id] = { type: "bps", bps };
  return input;
}

/** Extras surcharges on gameboost.com (2026-11-25), in basis points. */
const LOL_EXTRAS = { "priority-completion": 2500, "stream-games": 1500, "solo-only-queue": 2000, "hidden-duo": 2500 };
export const OPTION_BPS_OVERRIDES: Record<string, Record<string, number>> = {
  "league-of-legends:rank-boost": LOL_EXTRAS,
  "league-of-legends:win-boost": LOL_EXTRAS,
  "league-of-legends:placement-boost": { ...LOL_EXTRAS, "priority-completion": 2000 },
  "league-of-legends:arena-boost": { ...LOL_EXTRAS, "champions-roles": 1000, "duo-champions-roles": 1000 },
  "league-of-legends:champion-mastery": { "priority-completion": 2000, "stream-games": 1500 },
};

export function allMarketPriceInputs(): ServicePriceInput[] {
  return gameServices
    .map((o) => buildMarketPriceInput(o.gameSlug, o.serviceSlug))
    .filter((x): x is ServicePriceInput => x !== null);
}
