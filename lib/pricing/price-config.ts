/**
 * Shape and validation of an admin-configured ServicePrice.
 *
 * Nothing here invents a price: an amount exists only if an admin entered
 * it. Every rank tier, option and mode that can be selected must be priced
 * explicitly (0 is a valid explicit price); anything unpriced makes the
 * order unpurchasable instead of silently free.
 */
import { z } from "zod";
import { MAX_AMOUNT, normalizeCurrency } from "@/lib/money";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { unitKeyFields, unitStepKeys } from "./units";

const amount = z.number().int().min(0).max(MAX_AMOUNT);

export const adjustmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), amount }).strict(),
  z.object({ type: z.literal("bps"), bps: z.number().int().min(0).max(10_000) }).strict(),
]);
export type PriceAdjustment = z.infer<typeof adjustmentSchema>;

export const servicePriceInputSchema = z
  .object({
    gameSlug: z.string().min(1).max(64),
    serviceSlug: z.string().min(1).max(64),
    currency: z.string().min(3).max(3),
    pricingModel: z.enum(["RANK_STEPS", "PER_UNIT", "FIXED"]),
    baseAmount: amount,
    stepAmounts: z.record(z.string().min(1).max(64), amount).optional(),
    unitFieldKey: z.string().min(1).max(64).optional(),
    unitAmount: amount.optional(),
    optionPricing: z.record(z.string().min(1).max(64), adjustmentSchema).default({}),
    modePricing: z.record(z.string().min(1).max(16), adjustmentSchema).default({}),
    /** Free-text admin note. Not used for pricing; kept in the audit log only. */
    note: z.string().trim().max(200).optional(),
  })
  .strict();

/** Audit-note prefix that marks a price as temporary test configuration. */
export const TEMPORARY_PRICE_NOTE_PREFIX = "TEMPORARY";
export type ServicePriceInput = z.infer<typeof servicePriceInputSchema>;

/** Persisted price as the engine reads it (JSON columns parsed). */
export interface ServicePriceConfig {
  id: string;
  version: number;
  gameSlug: string;
  serviceSlug: string;
  currency: string;
  pricingModel: "RANK_STEPS" | "PER_UNIT" | "FIXED";
  baseAmount: number;
  stepAmounts: Record<string, number> | null;
  unitFieldKey: string | null;
  unitAmount: number | null;
  optionPricing: Record<string, PriceAdjustment>;
  modePricing: Record<string, PriceAdjustment>;
}

const jsonRecord = (schema: z.ZodTypeAny) => z.record(z.string(), schema);

/** Parse a database row defensively; a malformed row is treated as unpriced. */
export function parseServicePriceRow(row: {
  id: string;
  version: number;
  gameSlug: string;
  serviceSlug: string;
  currency: string;
  pricingModel: string;
  baseAmount: number;
  stepAmounts: unknown;
  unitFieldKey: string | null;
  unitAmount: number | null;
  optionPricing: unknown;
  modePricing: unknown;
}): ServicePriceConfig | null {
  const steps = row.stepAmounts == null ? null : jsonRecord(amount).safeParse(row.stepAmounts);
  const options = jsonRecord(adjustmentSchema).safeParse(row.optionPricing ?? {});
  const modes = jsonRecord(adjustmentSchema).safeParse(row.modePricing ?? {});
  if ((steps && !steps.success) || !options.success || !modes.success) return null;
  if (!["RANK_STEPS", "PER_UNIT", "FIXED"].includes(row.pricingModel)) return null;
  return {
    id: row.id,
    version: row.version,
    gameSlug: row.gameSlug,
    serviceSlug: row.serviceSlug,
    currency: row.currency,
    pricingModel: row.pricingModel as ServicePriceConfig["pricingModel"],
    baseAmount: row.baseAmount,
    stepAmounts: steps ? (steps.data as Record<string, number>) : null,
    unitFieldKey: row.unitFieldKey,
    unitAmount: row.unitAmount,
    optionPricing: options.data as Record<string, PriceAdjustment>,
    modePricing: modes.data as Record<string, PriceAdjustment>,
  };
}

/**
 * Check a proposed price against the catalog. Returns human-readable errors
 * (empty = valid). Does not check sellability: a price can be configured for
 * a service that is still draft-only; it simply stays unpurchasable.
 */
export function validateServicePriceAgainstCatalog(input: ServicePriceInput): string[] {
  const errors: string[] = [];
  try {
    normalizeCurrency(input.currency);
  } catch (e) {
    errors.push((e as Error).message);
  }
  const offer = getGameServiceOffer(input.gameSlug, input.serviceSlug);
  if (!offer) return [...errors, "Unknown game/service combination."];
  const checkout = getCheckoutConfig(input.gameSlug, input.serviceSlug);

  if (input.pricingModel === "RANK_STEPS") {
    const keys = new Set(offer.fields.map((f) => f.key));
    if (!offer.rankSystemId || !keys.has("currentRank") || !keys.has("targetRank")) {
      errors.push("RANK_STEPS pricing needs a service with current and target rank fields.");
    } else {
      const system = getRankSystem(offer.rankSystemId);
      const tierIds = new Set((system?.tiers ?? []).map((t) => t.id));
      const steps = input.stepAmounts ?? {};
      if (Object.keys(steps).length === 0) errors.push("RANK_STEPS pricing needs at least one tier step price.");
      for (const k of Object.keys(steps)) if (!tierIds.has(k)) errors.push(`Unknown rank tier: ${k}`);
    }
    if (input.unitFieldKey !== undefined || input.unitAmount !== undefined) errors.push("Unit pricing is only for PER_UNIT.");
  } else if (input.pricingModel === "PER_UNIT") {
    // A numeric field, or "range:<from>:<to>" over two numeric fields (lib/pricing/units.ts).
    const keys = input.unitFieldKey ? unitKeyFields(input.unitFieldKey) : [];
    if (keys.length === 0 || keys.some((k) => offer.fields.find((f) => f.key === k)?.type !== "number")) {
      errors.push("PER_UNIT pricing needs unitFieldKey to name a numeric field of this service.");
    }
    if (input.unitAmount === undefined || input.unitAmount <= 0) errors.push("PER_UNIT pricing needs a positive unitAmount.");
    // Optional unit price per current-rank tier or per mastery level (lib/pricing/units.ts).
    if (input.stepAmounts !== undefined && input.unitFieldKey) {
      const allowed = unitStepKeys(input.unitFieldKey, offer.fields, (id) => (getRankSystem(id)?.tiers ?? []).map((t) => t.id));
      if (!allowed) errors.push("This service has no per-rank or per-level unit prices.");
      else for (const k of Object.keys(input.stepAmounts)) if (!allowed.includes(k)) errors.push(`Unknown unit step: ${k}`);
    }
  } else {
    if (input.baseAmount <= 0) errors.push("FIXED pricing needs a positive baseAmount.");
    if (input.stepAmounts !== undefined || input.unitFieldKey !== undefined || input.unitAmount !== undefined) {
      errors.push("FIXED pricing takes only a base amount, options and modes.");
    }
  }

  const optionIds = new Set((checkout?.options ?? []).map((o) => o.id));
  for (const k of Object.keys(input.optionPricing)) if (!optionIds.has(k)) errors.push(`Unknown option: ${k}`);
  const modeIds = new Set<string>((checkout?.modes ?? []).map((m) => m.id));
  for (const k of Object.keys(input.modePricing)) if (!modeIds.has(k)) errors.push(`Unknown mode: ${k}`);
  return errors;
}
