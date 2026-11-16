/**
 * Coupon rules [registry F2]. PURE: no I/O (the DB lookup lives in
 * lib/pricing/service.ts).
 *
 * A coupon is PLATFORM-FUNDED: the engine computes the booster share on the
 * price before the discount and caps the discount at the platform fee, so a
 * coupon can never lower what the booster earns (spec 6.2:
 * booster_payout = total_before_discount x (1 - platform_fee)).
 */

export interface CouponRow {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  percentBps: number | null;
  amount: number | null;
  currency: string | null;
  maxDiscount: number | null;
  minSubtotal: number | null;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  gameSlug: string | null;
  serviceSlug: string | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  active: boolean;
}

export interface CouponContext {
  subtotal: number;
  currency: string;
  gameSlug: string;
  serviceSlug: string;
  now: Date;
  /** Orders already using the coupon (paid or in checkout). */
  totalUses: number;
  /** Same, for this customer; null when the customer is unknown (public quote). */
  customerUses: number | null;
}

export type CouponCheck =
  | { ok: true; discount: number }
  | { ok: false; reason: string };

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Is this coupon usable here, and for how much (before the platform cap)? */
export function evaluateCoupon(c: CouponRow, ctx: CouponContext): CouponCheck {
  if (!c.active) return { ok: false, reason: "This code is no longer active." };
  if (c.startsAt && ctx.now < c.startsAt) return { ok: false, reason: "This code is not active yet." };
  if (c.expiresAt && ctx.now >= c.expiresAt) return { ok: false, reason: "This code has expired." };
  if (c.gameSlug && c.gameSlug !== ctx.gameSlug) return { ok: false, reason: "This code is not valid for this game." };
  if (c.serviceSlug && c.serviceSlug !== ctx.serviceSlug) return { ok: false, reason: "This code is not valid for this service." };
  if (c.maxRedemptions !== null && ctx.totalUses >= c.maxRedemptions) return { ok: false, reason: "This code has been fully used." };
  if (ctx.customerUses !== null && ctx.customerUses >= c.perCustomerLimit) return { ok: false, reason: "You have already used this code." };
  if (c.minSubtotal !== null && ctx.subtotal < c.minSubtotal) return { ok: false, reason: "Your order is below this code's minimum amount." };

  let discount: number;
  if (c.type === "PERCENT") {
    discount = Math.floor((ctx.subtotal * (c.percentBps ?? 0)) / 10_000);
  } else {
    if (!c.currency || c.currency.toUpperCase() !== ctx.currency.toUpperCase()) {
      return { ok: false, reason: "This code is not valid in this currency." };
    }
    discount = c.amount ?? 0;
  }
  if (c.maxDiscount !== null) discount = Math.min(discount, c.maxDiscount);
  discount = Math.max(0, Math.min(discount, ctx.subtotal));
  if (discount === 0) return { ok: false, reason: "This code gives no discount on this order." };
  return { ok: true, discount };
}
