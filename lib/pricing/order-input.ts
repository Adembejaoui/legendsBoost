/**
 * Strict, server-side validation of a customer's order configuration.
 *
 * The request schema is .strict(): any field the browser adds (a price, a
 * total, a commission...) makes the request invalid. Prices are computed on
 * the server only. The only money-related value the browser may send is the
 * total it was shown (`expectedTotal`), which is compared with the server
 * quote so a customer is never charged a price they did not see.
 */
import { z } from "zod";
import type { ConfigField, GameServiceOffer, RankSelection } from "@/types/catalog";
import type { GameCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem, isTargetAboveCurrent } from "@/lib/catalog/rank-systems";
import { getChampion, LOL_ROLE_IDS, normalizeChampionId } from "@/lib/catalog/champions";
import { MAX_AMOUNT } from "@/lib/money";
import { isVpnCountry } from "@/lib/catalog/vpn-countries";
import { SITE_CURRENCIES } from "@/lib/currency/currencies";

export const orderRequestSchema = z
  .object({
    gameSlug: z.string().min(1).max(64),
    serviceSlug: z.string().min(1).max(64),
    configuration: z.record(z.string().max(64), z.unknown()).default({}),
    selectedMode: z.enum(["solo", "duo"]).optional(),
    selectedOptions: z.array(z.string().min(1).max(64)).max(20).default([]),
    /**
     * The customer accepted the risk disclosure (lib/orders/risk-disclosure.ts).
     * Required to CREATE an order (checked there), not to get a quote.
     */
    riskAccepted: z.literal(true).optional(),
    /** Booster the customer chose (lib/pool/preferred.ts); checked at order creation. */
    preferredBoosterId: z.string().min(1).max(64).optional(),
    /** Optional discount code (validated against the coupon table by the server). */
    couponCode: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/, "Invalid discount code")
      .optional(),
    championsRoles: z
      .object({
        /** [main role, secondary role] (client 2026-11-24): at most two, never the same. */
        roles: z.array(z.string().min(1).max(32)).max(2),
        champions: z.array(z.string().min(1).max(64)).max(20),
        /** "OTP Champ Only" extra: the one champion the booster must play. */
        otpChampion: z.string().min(1).max(64).optional(),
        /** VPN extra: the country the booster's VPN must be set to (ISO code). */
        vpnCountry: z.string().length(2).optional(),
      })
      .strict()
      .optional(),
    /**
     * Currency the customer pays in (multi-currency 2026-11-23). Absent: the
     * service's own price-list currency.
     */
    currency: z.enum(SITE_CURRENCIES).optional(),
    /**
     * Pay part of the order with the customer's cashback (2026-11-24). Only a
     * yes/no: the server computes the amount from the balance.
     */
    useCashback: z.boolean().optional(),
    /** The total the customer was shown; must equal the server quote. */
    expectedTotal: z
      .object({ amount: z.number().int().min(0).max(MAX_AMOUNT), currency: z.string().length(3) })
      .strict()
      .optional(),
  })
  .strict();
export type OrderRequest = z.infer<typeof orderRequestSchema>;

export interface NormalizedOrderInput {
  gameSlug: string;
  serviceSlug: string;
  configuration: Record<string, unknown>;
  selectedMode: "solo" | "duo" | null;
  selectedOptions: string[];
  championsRoles: { roles: string[]; champions: string[]; otpChampion?: string; vpnCountry?: string } | null;
  /** Upper-case coupon code; absent when none (keeps older request hashes stable). */
  couponCode?: string;
  /** Currency to charge; absent = the price list's own (keeps older request hashes stable). */
  currency?: string;
  /** Pay with cashback; absent when not asked (keeps older request hashes stable). */
  useCashback?: true;
}

type Result = { ok: true; value: NormalizedOrderInput } | { ok: false; errors: string[] };

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function validateField(field: ConfigField, raw: unknown, errors: string[]): unknown {
  switch (field.type) {
    case "rank-picker": {
      const system = getRankSystem(field.rankSystemId);
      const v = raw as Partial<RankSelection> | null;
      if (!v || typeof v !== "object" || typeof v.tierId !== "string") {
        errors.push(`${field.label} is not a valid rank.`);
        return undefined;
      }
      const tier = system?.tiers.find((t) => t.id === v.tierId);
      if (!tier) {
        errors.push(`${field.label}: unknown rank tier.`);
        return undefined;
      }
      const divisionId = v.divisionId ?? null;
      if (tier.divisions && tier.divisions.length > 0) {
        if (typeof divisionId !== "string" || !tier.divisions.some((d) => d.id === divisionId)) {
          errors.push(`${field.label}: choose a valid division.`);
          return undefined;
        }
      } else if (divisionId !== null) {
        errors.push(`${field.label}: this tier has no divisions.`);
        return undefined;
      }
      const extra = Object.keys(v).filter((k) => k !== "tierId" && k !== "divisionId");
      if (extra.length) errors.push(`${field.label}: unexpected properties.`);
      return { tierId: tier.id, divisionId };
    }
    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isInteger(n)) {
        errors.push(`${field.label} must be a whole number.`);
        return undefined;
      }
      if (field.min !== undefined && n < field.min) errors.push(`${field.label} must be at least ${field.min}.`);
      if (field.max !== undefined && n > field.max) errors.push(`${field.label} must be at most ${field.max}.`);
      return n;
    }
    case "select": {
      if (typeof raw !== "string" || !field.options.some((o) => o.value === raw)) {
        errors.push(`${field.label}: invalid choice.`);
        return undefined;
      }
      return raw;
    }
    case "multi-select": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || !field.options.some((o) => o.value === x))) {
        errors.push(`${field.label}: invalid choice.`);
        return undefined;
      }
      if (new Set(raw).size !== raw.length) errors.push(`${field.label}: duplicate choice.`);
      return [...raw];
    }
    case "checkbox": {
      if (typeof raw !== "boolean") {
        errors.push(`${field.label} must be true or false.`);
        return undefined;
      }
      return raw;
    }
    case "champion-picker": {
      if (typeof raw !== "string" || !getChampion(raw)) {
        errors.push(`${field.label}: unknown champion.`);
        return undefined;
      }
      return raw;
    }
  }
}

export function validateOrderInput(
  offer: GameServiceOffer,
  checkout: GameCheckoutConfig,
  input: OrderRequest
): Result {
  const errors: string[] = [];
  const fieldsByKey = new Map(offer.fields.map((f) => [f.key, f]));
  const configuration: Record<string, unknown> = {};

  for (const key of Object.keys(input.configuration)) {
    if (!fieldsByKey.has(key)) errors.push(`Unknown configuration field: ${key}`);
  }
  for (const field of offer.fields) {
    const raw = input.configuration[field.key];
    if (isEmpty(raw)) {
      if (field.required) errors.push(`Missing required field: ${field.label}`);
      continue;
    }
    const value = validateField(field, raw, errors);
    if (value !== undefined) configuration[field.key] = value;
  }

  const rankSystemId = offer.rankSystemId;
  if (rankSystemId && configuration.currentRank && configuration.targetRank) {
    if (!isTargetAboveCurrent(rankSystemId, configuration.currentRank as RankSelection, configuration.targetRank as RankSelection)) {
      errors.push("Target rank must be above the current rank.");
    }
  }

  const enabledModes = (checkout.modes ?? []).filter((m) => m.enabled).map((m) => m.id);
  let selectedMode: "solo" | "duo" | null = null;
  if (enabledModes.length > 0) {
    if (!input.selectedMode || !enabledModes.includes(input.selectedMode)) errors.push("Choose a valid boost mode.");
    else selectedMode = input.selectedMode;
  } else if (input.selectedMode) {
    errors.push("This service has no boost modes.");
  }

  const options = new Map(checkout.options.map((o) => [o.id, o]));
  if (new Set(input.selectedOptions).size !== input.selectedOptions.length) errors.push("Duplicate option.");
  for (const id of input.selectedOptions) {
    const option = options.get(id);
    if (!option || !option.enabled) {
      errors.push(`Unknown or unavailable option: ${id}`);
      continue;
    }
    if (selectedMode && option.availableModes && !option.availableModes.includes(selectedMode)) {
      errors.push(`Option ${option.label} is not available in ${selectedMode} mode.`);
    }
  }

  // Champions & roles: only real lanes and real champions (current ids).
  let championsRoles: { roles: string[]; champions: string[]; otpChampion?: string; vpnCountry?: string } | null = null;
  if (input.championsRoles) {
    const roles = input.championsRoles.roles;
    for (const r of roles) if (!LOL_ROLE_IDS.has(r)) errors.push(`Unknown role: ${r}`);
    if (roles.length > 2) errors.push("Choose at most two roles: a main role and a secondary role.");
    else if (roles.length === 2 && roles[0] === roles[1]) errors.push("The secondary role must be different from the main role.");
    const champs: string[] = [];
    for (const c of input.championsRoles.champions) {
      const id = normalizeChampionId(c);
      if (!id) errors.push(`Unknown champion: ${c}`);
      else if (!champs.includes(id)) champs.push(id);
    }
    let otp: string | undefined;
    if (input.championsRoles.otpChampion) {
      otp = normalizeChampionId(input.championsRoles.otpChampion) ?? undefined;
      if (!otp) errors.push(`Unknown champion: ${input.championsRoles.otpChampion}`);
    }
    let vpn: string | undefined;
    if (input.championsRoles.vpnCountry) {
      vpn = input.championsRoles.vpnCountry.toUpperCase();
      if (!isVpnCountry(vpn)) errors.push(`Unknown VPN country: ${input.championsRoles.vpnCountry}`);
      // Only kept while the VPN extra is bought.
      if (!input.selectedOptions.includes("vpn")) vpn = undefined;
    }
    championsRoles = { roles, champions: champs, ...(otp ? { otpChampion: otp } : {}), ...(vpn ? { vpnCountry: vpn } : {}) };
  }
  // OTP Champ Only replaces Specific Champion and Role (client PDFs 2026-11-24).
  if (input.selectedOptions.includes("otp-champion") && input.selectedOptions.includes("champions-roles")) {
    errors.push("Specific Champion and Role is not available with OTP Champ Only.");
  }
  // OTP Champ Only needs its champion.
  if (input.selectedOptions.includes("otp-champion") && !championsRoles?.otpChampion) {
    errors.push("Choose the champion for OTP Champ Only.");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      gameSlug: offer.gameSlug,
      serviceSlug: offer.serviceSlug,
      configuration,
      selectedMode,
      selectedOptions: [...input.selectedOptions].sort(),
      championsRoles,
      ...(input.couponCode ? { couponCode: input.couponCode.trim().toUpperCase() } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.useCashback === true ? { useCashback: true as const } : {}),
    },
  };
}
