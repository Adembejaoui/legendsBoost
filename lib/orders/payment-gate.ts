/**
 * Marketplace payment gate.
 *
 * An order may be listed to, or claimed by, boosters only when a payment has
 * been verified server-side. Order status alone (e.g. PENDING) never implies
 * payment.
 *
 * `Order.paymentVerifiedAt` is the single source of truth. In Phase 1 NO code
 * path sets it: Stripe is not implemented, and there is deliberately no
 * manual "mark as paid" shortcut. The future verified Stripe webhook will be
 * the only writer. Until then every order (including legacy PENDING orders)
 * is treated as unpaid and stays out of the marketplace.
 */

/** Prisma `where` fragment: the order has a verified payment. */
export const VERIFIED_PAYMENT_WHERE = { paymentVerifiedAt: { not: null } } as const;

export function hasVerifiedPayment(order: { paymentVerifiedAt?: Date | string | null }): boolean {
  return order.paymentVerifiedAt !== null && order.paymentVerifiedAt !== undefined;
}

export const PAYMENT_NOT_VERIFIED_MESSAGE =
  "This order has no verified payment and cannot be made available to boosters.";

/**
 * Orders the CUSTOMER sees (dashboard, order page, order list API).
 *
 * An order exists for the customer only once it is paid. While they are on
 * Stripe, the server keeps an invisible CHECKOUT HOLD:
 *   - status AWAITING_PAYMENT (checkout in progress), or
 *   - status CANCELLED, never paid, with a price snapshot (a checkout that
 *     ended without payment; only the Stripe checkout flow creates snapshots).
 * Legacy orders from before online payment (no snapshot) stay visible.
 */
export const CUSTOMER_VISIBLE_ORDER_WHERE = {
  NOT: [
    { status: "AWAITING_PAYMENT" as const },
    { status: "CANCELLED" as const, paymentVerifiedAt: null, pricingSnapshot: { isNot: null } },
  ],
};

export function isCheckoutHold(order: {
  status: string;
  paymentVerifiedAt?: Date | string | null;
  pricingSnapshot?: unknown;
}): boolean {
  if (order.status === "AWAITING_PAYMENT") return true;
  return order.status === "CANCELLED" && !order.paymentVerifiedAt && order.pricingSnapshot != null;
}
