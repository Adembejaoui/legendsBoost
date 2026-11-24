/**
 * Pure price calculation. No I/O, no floats: every line is an integer amount
 * in minor units. Discounts and tax are isolated, explicit hooks that are
 * DISABLED in this release (both return 0) until the business rules exist.
 */
import type { GameServiceOffer, RankSelection } from "@/types/catalog";
import { cashbackForOrder } from "@/lib/cashback/state";
import type { GameCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { assertAmount, bpsOfRounded, MAX_AMOUNT, splitCommission, type CommissionSplit } from "@/lib/money";
import type { NormalizedOrderInput } from "./order-input";
import type { PriceAdjustment, ServicePriceConfig } from "./price-config";
import { unitsFor } from "./units";
import { CURRENT_LP_DISCOUNT_BPS, CURRENT_LP_FIELD, LP_GAIN_ADJUSTMENT_BPS, LP_GAIN_FIELD } from "./lp-modifiers";

export interface QuoteLine {
  code: string;
  label: string;
  amount: number;
}

export interface Quote {
  currency: string;
  lines: QuoteLine[];
  subtotalAmount: number;
  /** Coupon + cashback (both platform-funded). */
  discountAmount: number;
  /** Part of discountAmount paid with the customer's cashback. */
  cashbackAmount: number;
  taxAmount: number;
  totalAmount: number;
  commissionBaseAmount: number;
  commission: CommissionSplit;
  servicePriceId: string;
  servicePriceVersion: number;
  commissionPolicyId: string;
  /**
   * Price of every priced extra of the selected mode, selected or not, so the
   * order summary can show "+$1.96" before an extra is switched on.
   */
  optionAmounts: Record<string, number>;
  /**
   * Set when the price list was converted to the customer's currency
   * (lib/currency/rates.ts): the rate used, kept with the order.
   */
  fx?: { from: string; to: string; rate: number; date: string } | null;
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; reason: string };

/**
 * Discount actually applied: the requested coupon discount (lib/pricing/
 * coupons.ts), capped at the platform fee on the pre-discount price, so the
 * booster share is never reduced by a coupon (platform-funded discounts).
 */
export function computeDiscount(requested: number, platformFeeBeforeDiscount: number): number {
  if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
  return Math.min(requested, Math.max(0, platformFeeBeforeDiscount));
}

/**
 * Tax: no tax rules are configured; prices are charged as configured. This
 * is the single place to introduce tax, which is NEVER part of the
 * commission base (see calculateQuote).
 */
export function computeTax(): number {
  return 0;
}

/** Ascending list of ladder positions: [{tierId, divisionId}], lowest first. */
export function rankLadder(rankSystemId: string): { tierId: string; divisionId: string | null }[] {
  const system = getRankSystem(rankSystemId);
  if (!system) return [];
  const tiers = [...system.tiers].sort((a, b) => a.order - b.order);
  const ladder: { tierId: string; divisionId: string | null }[] = [];
  for (const t of tiers) {
    if (t.divisions && t.divisions.length > 0) for (const d of t.divisions) ladder.push({ tierId: t.id, divisionId: d.id });
    else ladder.push({ tierId: t.id, divisionId: null });
  }
  return ladder;
}

function position(ladder: { tierId: string; divisionId: string | null }[], sel: RankSelection) {
  return ladder.findIndex((p) => p.tierId === sel.tierId && p.divisionId === (sel.divisionId ?? null));
}

function applyAdjustment(adj: PriceAdjustment, base: number): number {
  return adj.type === "fixed" ? adj.amount : bpsOfRounded(base, adj.bps);
}

export function calculateQuote(
  offer: GameServiceOffer,
  checkout: GameCheckoutConfig,
  price: ServicePriceConfig,
  commissionPolicy: { id: string; platformFeeBps: number; boosterShareBps: number },
  input: NormalizedOrderInput,
  /** LP brackets from config (lib/config); defaults to lp-modifiers.ts. */
  lpModifiers: { currentDiscountBps: Record<string, number>; gainAdjustBps: Record<string, number> } = {
    currentDiscountBps: CURRENT_LP_DISCOUNT_BPS,
    gainAdjustBps: LP_GAIN_ADJUSTMENT_BPS,
  },
  /** Coupon discount already validated by the caller (before the platform cap). */
  couponDiscount = 0,
  /**
   * Cashback the customer asked to use (lib/cashback/state.ts): at most
   * `maxOrderBps` of the amount left after the coupon, and never more than
   * the platform fee left after the coupon (booster share untouched).
   */
  cashback: { available: number; maxOrderBps: number } | null = null
): QuoteResult {
  const lines: QuoteLine[] = [{ code: "BASE", label: "Base price", amount: price.baseAmount }];

  if (price.pricingModel === "RANK_STEPS") {
    if (!offer.rankSystemId) return { ok: false, reason: "This service is not priced by rank." };
    const current = input.configuration.currentRank as RankSelection | undefined;
    const target = input.configuration.targetRank as RankSelection | undefined;
    if (!current || !target) return { ok: false, reason: "Current and target rank are required." };
    const ladder = rankLadder(offer.rankSystemId);
    const from = position(ladder, current);
    const to = position(ladder, target);
    if (from < 0 || to < 0 || to <= from) return { ok: false, reason: "Target rank must be above the current rank." };
    const steps = price.stepAmounts ?? {};
    const byTier = new Map<string, number>();
    for (let i = from; i < to; i++) {
      const tierId = ladder[i].tierId;
      const stepAmount = steps[tierId];
      if (stepAmount === undefined) return { ok: false, reason: "This rank range is not available for purchase yet." };
      byTier.set(tierId, (byTier.get(tierId) ?? 0) + stepAmount);
    }
    for (const [tierId, amount] of byTier) lines.push({ code: `STEPS:${tierId}`, label: `Rank steps (${tierId})`, amount });

    // LP modifiers (only for services whose catalog asks for them).
    const stepsTotal = [...byTier.values()].reduce((a, b) => a + b, 0);
    const firstStep = steps[ladder[from].tierId] ?? 0;
    let lpDiscount = 0;
    const lpBracket = input.configuration[CURRENT_LP_FIELD];
    if (typeof lpBracket === "string") {
      const bps = lpModifiers.currentDiscountBps[lpBracket];
      if (bps === undefined) return { ok: false, reason: "Invalid current LP." };
      lpDiscount = bpsOfRounded(firstStep, bps);
      if (lpDiscount > 0) lines.push({ code: "LP:CURRENT", label: `Current LP ${lpBracket}`, amount: -lpDiscount });
    }
    const gain = input.configuration[LP_GAIN_FIELD];
    if (typeof gain === "string") {
      const bps = lpModifiers.gainAdjustBps[gain];
      if (bps === undefined) return { ok: false, reason: "Invalid LP gain." };
      const base = stepsTotal - lpDiscount;
      const adj = bps >= 0 ? bpsOfRounded(base, bps) : -bpsOfRounded(base, -bps);
      if (adj !== 0) lines.push({ code: "LP:GAIN", label: `LP gain (${gain})`, amount: adj });
    }
  } else if (price.pricingModel === "PER_UNIT") {
    if (!price.unitFieldKey || price.unitAmount == null) {
      return { ok: false, reason: "This service is not available for purchase yet." };
    }
    // A numeric field, or a range of two (Champion Mastery levels).
    const counted = unitsFor(price.unitFieldKey, input.configuration, offer.fields);
    if (!counted.ok) return { ok: false, reason: counted.reason };
    const units = counted.units;
    lines.push({ code: `UNITS:${price.unitFieldKey}`, label: `${units} x unit price`, amount: units * price.unitAmount });
  }

  const serviceAmount = lines.reduce((a, l) => a + l.amount, 0);
  if (serviceAmount > MAX_AMOUNT) return { ok: false, reason: "Order amount is too large." };

  if (input.selectedMode) {
    const adj = price.modePricing[input.selectedMode];
    if (!adj) return { ok: false, reason: "This boost mode is not available for purchase yet." };
    lines.push({ code: `MODE:${input.selectedMode}`, label: `${input.selectedMode} mode`, amount: applyAdjustment(adj, serviceAmount) });
  }
  for (const id of input.selectedOptions) {
    const adj = price.optionPricing[id];
    if (!adj) return { ok: false, reason: "One of the selected options is not available for purchase yet." };
    lines.push({ code: `OPTION:${id}`, label: id, amount: applyAdjustment(adj, serviceAmount) });
  }

  const optionAmounts: Record<string, number> = {};
  const mode = input.selectedMode ?? "solo";
  for (const o of checkout.options ?? []) {
    if (o.availableModes && !o.availableModes.includes(mode)) continue;
    const adj = price.optionPricing[o.id];
    if (adj && o.enabled !== false) optionAmounts[o.id] = applyAdjustment(adj, serviceAmount);
  }

  const subtotalAmount = lines.reduce((a, l) => a + l.amount, 0);
  if (subtotalAmount <= 0) return { ok: false, reason: "This service is not available for purchase yet." };
  if (subtotalAmount > MAX_AMOUNT) return { ok: false, reason: "Order amount is too large." };
  assertAmount(subtotalAmount);

  // Booster share is fixed on the price BEFORE any discount; the platform
  // fee absorbs the discount. Without a coupon this equals the plain split.
  const beforeDiscount = splitCommission(subtotalAmount, commissionPolicy);
  const couponAmount = computeDiscount(couponDiscount, beforeDiscount.platformFeeAmount);
  const cashbackAmount = cashback
    ? cashbackForOrder(cashback.available, subtotalAmount - couponAmount, cashback.maxOrderBps, beforeDiscount.platformFeeAmount - couponAmount)
    : 0;
  const discountAmount = couponAmount + cashbackAmount;
  const commissionBaseAmount = subtotalAmount - discountAmount;
  const taxAmount = computeTax();
  const commission = { ...beforeDiscount, platformFeeAmount: beforeDiscount.platformFeeAmount - discountAmount };

  return {
    ok: true,
    quote: {
      currency: price.currency,
      lines,
      subtotalAmount,
      discountAmount,
      cashbackAmount,
      taxAmount,
      totalAmount: commissionBaseAmount + taxAmount,
      commissionBaseAmount,
      commission,
      servicePriceId: price.id,
      servicePriceVersion: price.version,
      commissionPolicyId: commissionPolicy.id,
      optionAmounts,
    },
  };
}
