/**
 * Authoritative server-side quote: catalog eligibility + strict input
 * validation + the ACTIVE admin-configured price + the commission policy in
 * force. A service is purchasable only when all of them agree.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getOrderEligibility } from "@/lib/orders/order-eligibility";
import { calculateQuote, type Quote } from "./engine";
import { validateOrderInput, type NormalizedOrderInput, type OrderRequest } from "./order-input";
import { parseServicePriceRow, type ServicePriceConfig } from "./price-config";
import { getConfig } from "@/lib/config";
import { estimateCompletion, type Estimate } from "./eta";
import { evaluateCoupon } from "./coupons";
import { conversionFactor, getFxRates, priceInCurrency } from "@/lib/currency/rates";

type Db = Prisma.TransactionClient | typeof prisma;

export class PricingError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: string[]) {
    super(message);
    this.name = "PricingError";
  }
}

// Deliberately different from NOT_PURCHASABLE_MESSAGE (catalog eligibility):
// the two used to be identical, which hid which gate refused the order.
export const NOT_PRICED_MESSAGE = "No price is configured for this service yet.";
export const CURRENCY_UNAVAILABLE_MESSAGE = "Prices in this currency are not available right now. Please choose another currency.";

export async function getActiveServicePrice(gameSlug: string, serviceSlug: string, db: Db = prisma): Promise<ServicePriceConfig | null> {
  const row = await db.servicePrice.findUnique({ where: { activeKey: `${gameSlug}:${serviceSlug}` } });
  return row ? parseServicePriceRow(row) : null;
}

/** The policy in force: newest with effectiveFrom <= now. */
export async function getActiveCommissionPolicy(db: Db = prisma, now = new Date()) {
  return db.commissionPolicy.findFirst({
    where: { effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
}

export interface ServerQuote {
  input: NormalizedOrderInput;
  quote: Quote;
  serviceTitle: string;
  /** Estimated completion time (display only; never affects the price). */
  estimate: Estimate | null;
  /** Result of the requested discount code, if any. */
  coupon: CouponResult | null;
}

export interface CouponResult {
  code: string;
  applied: boolean;
  /** Why it was not applied (customer-facing). */
  reason?: string;
  couponId?: string;
}

/** Orders that count as a use: paid, or still in checkout (closed holds do not). */
function couponUseWhere(couponId: string, customerId?: string) {
  return {
    couponId,
    order: {
      ...(customerId ? { userId: customerId } : {}),
      OR: [{ paymentVerifiedAt: { not: null } }, { status: "AWAITING_PAYMENT" as const }],
    },
  };
}

export async function buildServerQuote(
  request: OrderRequest,
  db: Db = prisma,
  opts: { customerId?: string; now?: Date } = {}
): Promise<ServerQuote> {
  const eligibility = getOrderEligibility(request.gameSlug, request.serviceSlug);
  if (!eligibility.ok) throw new PricingError(eligibility.reason, eligibility.status);

  const validated = validateOrderInput(eligibility.offer, eligibility.checkout, request);
  if (!validated.ok) throw new PricingError(validated.errors[0], 400, validated.errors);

  const listPrice = await getActiveServicePrice(request.gameSlug, request.serviceSlug, db);
  if (!listPrice) throw new PricingError(NOT_PRICED_MESSAGE, 403);
  // The customer's currency: the whole price list is converted first, so every
  // amount (and the booster share) is a whole number in the charged currency.
  const priced = await priceInCurrency(listPrice, validated.value.currency);
  if (!priced) throw new PricingError(CURRENCY_UNAVAILABLE_MESSAGE, 503);
  const price = priced.price;
  const policy = await getActiveCommissionPolicy(db);
  if (!policy) throw new PricingError("Payments are not configured yet.", 503);

  const [currentDiscountBps, gainAdjustBps] = await Promise.all([getConfig("lp_current_discount_bps"), getConfig("lp_gain_adjust_bps")]);
  const lp = { currentDiscountBps, gainAdjustBps };
  let result = calculateQuote(eligibility.offer, eligibility.checkout, price, policy, validated.value, lp);
  if (!result.ok) throw new PricingError(result.reason, 403);

  // Discount code: evaluated on the undiscounted subtotal, then re-quoted.
  let coupon: CouponResult | null = null;
  const code = validated.value.couponCode;
  if (code) {
    const stored = await db.coupon.findUnique({ where: { code } });
    // A code set up in another currency: its amounts are converted at today's rate (no margin).
    let row = stored;
    if (stored?.currency && stored.currency !== result.quote.currency) {
      const factor = conversionFactor(stored.currency, result.quote.currency, await getFxRates());
      if (factor !== null) {
        const c = (n: number | null) => (n == null ? n : Math.round(n * factor));
        row = { ...stored, currency: result.quote.currency, amount: c(stored.amount), maxDiscount: c(stored.maxDiscount), minSubtotal: c(stored.minSubtotal) };
      }
    }
    if (!row) {
      coupon = { code, applied: false, reason: "This code does not exist." };
    } else {
      const [totalUses, customerUses] = await Promise.all([
        db.orderPricingSnapshot.count({ where: couponUseWhere(row.id) }),
        opts.customerId ? db.orderPricingSnapshot.count({ where: couponUseWhere(row.id, opts.customerId) }) : Promise.resolve(null),
      ]);
      const check = evaluateCoupon(row, {
        subtotal: result.quote.subtotalAmount,
        currency: result.quote.currency,
        gameSlug: request.gameSlug,
        serviceSlug: request.serviceSlug,
        now: opts.now ?? new Date(),
        totalUses,
        customerUses,
      });
      if (!check.ok) {
        coupon = { code, applied: false, reason: check.reason, couponId: row.id };
      } else {
        const discounted = calculateQuote(eligibility.offer, eligibility.checkout, price, policy, validated.value, lp, check.discount);
        if (!discounted.ok) throw new PricingError(discounted.reason, 403);
        result = discounted;
        coupon = { code, applied: result.quote.discountAmount > 0, couponId: row.id, ...(result.quote.discountAmount > 0 ? {} : { reason: "This code gives no discount on this order." }) };
      }
    }
  }

  if (request.expectedTotal) {
    const sameCurrency = request.expectedTotal.currency.toUpperCase() === result.quote.currency;
    if (!sameCurrency || request.expectedTotal.amount !== result.quote.totalAmount) {
      throw new PricingError("The price has changed. Please review the new total before confirming.", 409);
    }
  }
  const estimate = estimateCompletion(await getConfig("eta_model"), {
    pricingModel: price.pricingModel,
    rankSystemId: eligibility.offer.rankSystemId,
    configuration: validated.value.configuration,
    unitFieldKey: price.unitFieldKey,
    selectedMode: validated.value.selectedMode,
    selectedOptions: validated.value.selectedOptions,
  });
  return {
    input: validated.value,
    quote: { ...result.quote, fx: priced.fx },
    serviceTitle: eligibility.offer.title ?? request.serviceSlug,
    estimate,
    coupon,
  };
}

/** Public shape of a quote (no commission split: that is internal). */
export function publicQuote(q: Quote) {
  return {
    currency: q.currency,
    lines: q.lines,
    subtotalAmount: q.subtotalAmount,
    discountAmount: q.discountAmount,
    taxAmount: q.taxAmount,
    totalAmount: q.totalAmount,
    optionAmounts: q.optionAmounts,
  };
}
