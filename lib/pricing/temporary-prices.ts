/**
 * TEMPORARY test prices supplied by the owner (2026-11-13) so the purchase
 * and Stripe flow can be tested end to end. They are NOT final commercial
 * prices and are replaced later through Admin > Finance > Pricing.
 *
 * This module is never read by the running app. It is only the input of
 * scripts/apply-temporary-prices.ts, which writes each entry through the
 * normal admin path (createServicePriceVersion: validation, versioning,
 * audit row). The server keeps calculating every price from the stored
 * ServicePrice row; nothing here is a runtime fallback.
 *
 * Mapping of the owner's list to the catalog (see
 * docs/FULL-CATALOG-TEMPORARY-PRICING-REPORT.md for the reasoning):
 *   Rank Boost $10 / TFT Rank Boost $10 / VALORANT Rank Boost $10 /
 *   TFT Double Up $10  -> RANK_STEPS, base $10, every tier step $0
 *                         (no per-division price was given)
 *   Win Boost $3 per win (LoL, TFT) / VALORANT Win Boost $3 per win
 *                      -> PER_UNIT on "wins", base $0, $3 per win
 *   Placement Matches $8 -> FIXED $8 (no per-match price was given)
 *   Champion Mastery $5  -> FIXED $5
 *   Coaching $10         -> no coaching service exists in the 14-service catalog
 *   Arena Boost, Normal Matches, VALORANT Unrated Matches -> no price given:
 *                         left UNPRICED (they stay unpurchasable).
 * Modes and enabled extras: no modifier was given, so each is priced at an
 * explicit $0 (included) so every selectable combination has a price.
 */
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { TEMPORARY_PRICE_NOTE_PREFIX, type ServicePriceInput } from "./price-config";

export const TEMPORARY_PRICE_CURRENCY = "USD";
export const TEMPORARY_PRICE_NOTE = `${TEMPORARY_PRICE_NOTE_PREFIX} test price (owner-supplied 2026-11-13); replace before launch`;

type Spec =
  | { model: "RANK_STEPS"; baseAmount: number; stepAmount: number }
  | { model: "PER_UNIT"; baseAmount: number; unitFieldKey: string; unitAmount: number }
  | { model: "FIXED"; baseAmount: number };

/** Amounts in USD cents. A service missing here is deliberately left unpriced. */
export const TEMPORARY_PRICE_SPECS: Record<string, Spec> = {
  "league-of-legends:rank-boost": { model: "RANK_STEPS", baseAmount: 1000, stepAmount: 0 },
  "league-of-legends:win-boost": { model: "PER_UNIT", baseAmount: 0, unitFieldKey: "wins", unitAmount: 300 },
  "league-of-legends:placement-boost": { model: "FIXED", baseAmount: 800 },
  "league-of-legends:champion-mastery": { model: "FIXED", baseAmount: 500 },
  "valorant:rank-boost": { model: "RANK_STEPS", baseAmount: 1000, stepAmount: 0 },
  "valorant:win-boost": { model: "PER_UNIT", baseAmount: 0, unitFieldKey: "wins", unitAmount: 300 },
  "valorant:placement-boost": { model: "FIXED", baseAmount: 800 },
  "teamfight-tactics:rank-boost": { model: "RANK_STEPS", baseAmount: 1000, stepAmount: 0 },
  "teamfight-tactics:win-boost": { model: "PER_UNIT", baseAmount: 0, unitFieldKey: "wins", unitAmount: 300 },
  "teamfight-tactics:placement-boost": { model: "FIXED", baseAmount: 800 },
  "teamfight-tactics:double-up-boost": { model: "RANK_STEPS", baseAmount: 1000, stepAmount: 0 },
};

/** Catalog services with no owner-supplied temporary price. */
export const UNPRICED_SERVICES = gameServices
  .map((o) => `${o.gameSlug}:${o.serviceSlug}`)
  .filter((k) => !(k in TEMPORARY_PRICE_SPECS));

/**
 * Full admin input for one service: every rank tier, every ENABLED mode and
 * every ENABLED option gets an explicit amount. Disabled options cannot be
 * selected (the order validator rejects them), so they stay unpriced.
 */
export function buildTemporaryPriceInput(gameSlug: string, serviceSlug: string): ServicePriceInput | null {
  const spec = TEMPORARY_PRICE_SPECS[`${gameSlug}:${serviceSlug}`];
  const offer = gameServices.find((o) => o.gameSlug === gameSlug && o.serviceSlug === serviceSlug);
  if (!spec || !offer) return null;
  const checkout = getCheckoutConfig(gameSlug, serviceSlug);
  const zero = { type: "fixed" as const, amount: 0 };
  const input: ServicePriceInput = {
    gameSlug,
    serviceSlug,
    currency: TEMPORARY_PRICE_CURRENCY,
    pricingModel: spec.model,
    baseAmount: spec.baseAmount,
    optionPricing: Object.fromEntries((checkout?.options ?? []).filter((o) => o.enabled).map((o) => [o.id, zero])),
    modePricing: Object.fromEntries((checkout?.modes ?? []).filter((m) => m.enabled).map((m) => [m.id, zero])),
    note: TEMPORARY_PRICE_NOTE,
  };
  if (spec.model === "RANK_STEPS") {
    const tiers = getRankSystem(offer.rankSystemId ?? "")?.tiers ?? [];
    input.stepAmounts = Object.fromEntries(tiers.map((t) => [t.id, spec.stepAmount]));
  }
  if (spec.model === "PER_UNIT") {
    input.unitFieldKey = spec.unitFieldKey;
    input.unitAmount = spec.unitAmount;
  }
  return input;
}

export function allTemporaryPriceInputs(): ServicePriceInput[] {
  return gameServices
    .map((o) => buildTemporaryPriceInput(o.gameSlug, o.serviceSlug))
    .filter((x): x is ServicePriceInput => x !== null);
}
