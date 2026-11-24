/* eslint-disable @typescript-eslint/no-explicit-any -- generic catalog walking */
/**
 * Generic helpers that walk the REAL catalog (fields, rank systems, modes,
 * options) so every service can be exercised by the same test.
 *
 * Every amount below is a TEST FIXTURE. These are not business prices and
 * are never written anywhere except the in-memory test database.
 */
import type { GameServiceOffer } from "@/types/catalog";
import type { GameCheckoutConfig } from "@/lib/config/checkout-options";
import { rankLadder } from "@/lib/pricing/engine";
import { champions } from "@/lib/catalog/champions";

export const FIXTURE = { base: 1000, step: 500, unit: 300, mode: 200, option: 100 } as const;

export type Model = "RANK_STEPS" | "PER_UNIT" | "FIXED";

/** The pricing model a service supports, in the same order the admin form offers them. */
export function pricingModelFor(offer: GameServiceOffer): { model: Model; unitFieldKey?: string } {
  const keys = new Set(offer.fields.map((f) => f.key));
  if (offer.rankSystemId && keys.has("currentRank") && keys.has("targetRank")) return { model: "RANK_STEPS" };
  const requiredNumber = offer.fields.find((f) => f.type === "number" && f.required);
  if (requiredNumber) return { model: "PER_UNIT", unitFieldKey: requiredNumber.key };
  return { model: "FIXED" };
}

export function enabledModes(checkout: GameCheckoutConfig): ("solo" | "duo")[] {
  return (checkout.modes ?? []).filter((m) => m.enabled).map((m) => m.id);
}

export function enabledOptionsFor(checkout: GameCheckoutConfig, mode: "solo" | "duo" | null): string[] {
  return checkout.options
    .filter((o) => o.enabled && (!mode || !o.availableModes || o.availableModes.includes(mode)))
    .map((o) => o.id);
}

/** Extras a customer can buy together: OTP Champ Only replaces Specific Champion and Role (client PDFs 2026-11-24). */
export function buyableTogether(ids: string[]): string[] {
  return ids.includes("otp-champion") ? ids.filter((id) => id !== "champions-roles") : ids;
}

/** Admin input pricing EVERY tier, enabled mode and enabled option with fixture amounts. */
export function fixturePriceInput(offer: GameServiceOffer, checkout: GameCheckoutConfig, rankTierIds: string[]) {
  const { model, unitFieldKey } = pricingModelFor(offer);
  const input: Record<string, unknown> = {
    gameSlug: offer.gameSlug,
    serviceSlug: offer.serviceSlug,
    currency: "EUR",
    pricingModel: model,
    baseAmount: FIXTURE.base,
    optionPricing: Object.fromEntries(enabledOptionsFor(checkout, null).map((id) => [id, { type: "fixed", amount: FIXTURE.option }])),
    modePricing: Object.fromEntries(enabledModes(checkout).map((id) => [id, { type: "fixed", amount: FIXTURE.mode }])),
  };
  if (model === "RANK_STEPS") input.stepAmounts = Object.fromEntries(rankTierIds.map((t) => [t, FIXTURE.step]));
  if (model === "PER_UNIT") {
    input.unitFieldKey = unitFieldKey;
    input.unitAmount = FIXTURE.unit;
  }
  return input;
}

/** A valid configuration for every field of the offer; rank boosts climb 2 ladder steps. */
export function validConfiguration(offer: GameServiceOffer): { configuration: Record<string, unknown>; steps: number; units: number } {
  const configuration: Record<string, unknown> = {};
  let steps = 0;
  let units = 0;
  const { unitFieldKey } = pricingModelFor(offer);
  for (const f of offer.fields as any[]) {
    switch (f.type) {
      case "rank-picker": {
        const ladder = rankLadder(f.rankSystemId);
        if (f.key === "targetRank") {
          configuration[f.key] = ladder[2];
          steps = 2;
        } else {
          configuration[f.key] = ladder[0];
        }
        break;
      }
      case "number": {
        const n = f.min ?? 1;
        configuration[f.key] = n;
        if (f.key === unitFieldKey) units = n;
        break;
      }
      case "select":
        configuration[f.key] = f.options[0].value;
        break;
      case "multi-select":
        configuration[f.key] = [f.options[0].value];
        break;
      case "checkbox":
        configuration[f.key] = false;
        break;
      case "champion-picker":
        configuration[f.key] = champions[0].id;
        break;
    }
  }
  return { configuration, steps, units };
}

export function expectedTotal(offer: GameServiceOffer, steps: number, units: number, hasMode: boolean, optionCount: number) {
  const { model } = pricingModelFor(offer);
  let service = FIXTURE.base;
  if (model === "RANK_STEPS") service += steps * FIXTURE.step;
  if (model === "PER_UNIT") service += units * FIXTURE.unit;
  return service + (hasMode ? FIXTURE.mode : 0) + optionCount * FIXTURE.option;
}
