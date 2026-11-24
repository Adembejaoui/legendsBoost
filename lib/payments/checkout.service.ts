/**
 * Stripe Checkout for an AWAITING_PAYMENT order.
 *
 *  1. owner + CUSTOMER role (from the database), order AWAITING_PAYMENT,
 *     not already paid, has a price snapshot;
 *  2. amount and currency come ONLY from the snapshot;
 *  3. at most one open attempt per order (payment.openSlotOrderId unique):
 *     a still-valid open session is reused instead of creating another;
 *  4. Payment row created first, then the Stripe session with the
 *     idempotency key "checkout:<orderId>:<attempt>";
 *  5. if Stripe fails, the attempt is marked FAILED and the slot released,
 *     so the customer can safely retry.
 * Nothing here marks an order paid: only a verified webhook does.
 */
import prisma from "@/lib/prisma";
import { releaseCashbackForOrder } from "@/lib/cashback/service";
import type Stripe from "stripe";
import type { Prisma } from "@/app/generated/prisma/client";
import { getAppUrl, getStripe, safeErrorMessage, StripeConfigError, toStripeCurrency } from "@/lib/stripe/server";
import { enqueueOutbox, dispatchOutbox } from "./outbox";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getOrderEligibility, NOT_PURCHASABLE_MESSAGE } from "@/lib/orders/order-eligibility";
import { transitionOrders } from "@/lib/orders/transitions";
import { getConfig } from "@/lib/config";
import { buildOrderSummary } from "@/lib/orders/order-summary";

export class CheckoutError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CheckoutError";
  }
}

/** Reuse an open session only if it stays valid for at least this long. */
const REUSE_MARGIN_MS = 2 * 60_000;
/** A CREATED attempt older than this is considered abandoned. */
const STALE_CREATED_MS = 2 * 60_000;
/** Stripe requires 30 min - 24 h; keep checkout short. */
const SESSION_LIFETIME_S = 30 * 60 + 60;
/**
 * An unpaid order is only a short-lived CHECKOUT HOLD: it exists while the
 * customer is on Stripe and is never shown to anyone. Orders are "created"
 * for the customer only when Stripe confirms the payment. A hold older than
 * this can no longer be paid (no "pay later"); it is closed instead.
 */
export const CHECKOUT_HOLD_TTL_MS = 60 * 60_000;

/** Effective TTL: config `checkout_hold_ttl_min` (default = CHECKOUT_HOLD_TTL_MS). */
export async function checkoutHoldTtlMs(): Promise<number> {
  return (await getConfig("checkout_hold_ttl_min")) * 60_000;
}

type Tx = Prisma.TransactionClient;

/**
 * Close an unpaid checkout hold (status AWAITING_PAYMENT -> CANCELLED).
 * Conditional: never touches a paid order or one with a payment still
 * processing. Returns true if the hold was closed.
 */
export async function closeCheckoutHold(tx: Tx, orderId: string, reason: string): Promise<boolean> {
  const processing = await tx.payment.count({ where: { orderId, status: "PROCESSING" } });
  if (processing > 0) return false;
  const r = await transitionOrders(tx, {
    where: { id: orderId, status: "AWAITING_PAYMENT", paymentVerifiedAt: null, paidPaymentId: null },
    to: "CANCELLED",
  });
  if (r.count === 0) return false;
  // Cashback reserved for this checkout comes back.
  await releaseCashbackForOrder(tx, orderId);
  const open = await tx.payment.findMany({
    where: { orderId, status: { in: ["CREATED", "OPEN"] } },
    select: { id: true, stripeCheckoutSessionId: true },
  });
  if (open.length) {
    await tx.payment.updateMany({ where: { id: { in: open.map((p) => p.id) } }, data: { status: "CANCELED", openSlotOrderId: null } });
    await enqueueOutbox(
      tx,
      open
        .filter((p) => p.stripeCheckoutSessionId)
        .map((p) => ({
          type: "EXPIRE_CHECKOUT_SESSION" as const,
          dedupeKey: `expire:${p.stripeCheckoutSessionId}`,
          payload: { sessionId: p.stripeCheckoutSessionId! },
        }))
    );
  }
  await tx.orderEvent.create({
    data: { orderId, type: "CHECKOUT_CLOSED", message: "Checkout ended without payment", metadata: { reason } },
  });
  return true;
}

/** Customer left Stripe ("back" / cancel): close their unpaid hold. */
export async function abandonCheckout(customerId: string, orderId: string): Promise<{ closed: boolean }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
  if (!order || order.userId !== customerId) throw new CheckoutError("Order not found", 404);
  const closed = await prisma.$transaction((tx) => closeCheckoutHold(tx, orderId, "customer_cancelled_checkout"));
  await dispatchOutbox({ limit: 5 });
  return { closed };
}

/**
 * Close holds that outlived the TTL (abandoned tabs). One customer's (when a
 * new checkout starts) or everyone's (scheduled job, customerId = null).
 */
export async function closeStaleCheckoutHolds(customerId: string | null, now = new Date(), limit = 20): Promise<number> {
  const ttl = await checkoutHoldTtlMs();
  const stale = await prisma.order.findMany({
    where: {
      ...(customerId ? { userId: customerId } : {}),
      status: "AWAITING_PAYMENT",
      paymentVerifiedAt: null,
      createdAt: { lt: new Date(now.getTime() - ttl) },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let closed = 0;
  for (const o of stale) {
    if (await prisma.$transaction((tx) => closeCheckoutHold(tx, o.id, "checkout_hold_expired"))) closed++;
  }
  return closed;
}

export async function createCheckoutForOrder(customerId: string, orderId: string) {
  const user = await prisma.user.findUnique({ where: { id: customerId }, select: { role: true } });
  if (!user || (user.role ?? "CUSTOMER") !== "CUSTOMER") throw new CheckoutError("Only the customer can pay for an order.", 403);

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { pricingSnapshot: true } });
  if (!order || order.userId !== customerId) throw new CheckoutError("Order not found", 404);
  if (order.paymentVerifiedAt || order.paidPaymentId) throw new CheckoutError("This order is already paid.", 409);
  if (order.status !== "AWAITING_PAYMENT") throw new CheckoutError("This order is not awaiting payment.", 409);
  // No "pay later": an old hold is closed, the customer starts a new order.
  if (Date.now() - order.createdAt.getTime() > (await checkoutHoldTtlMs())) {
    await prisma.$transaction((tx) => closeCheckoutHold(tx, orderId, "checkout_hold_expired"));
    throw new CheckoutError("This checkout has expired. Please configure your order again.", 409);
  }
  const snapshot = order.pricingSnapshot;
  if (!snapshot) throw new CheckoutError("This order cannot be paid online.", 409);
  // Re-check catalog eligibility under the CURRENT Stripe mode: an order
  // created while compliance was waived for test mode must not become
  // payable with real money if live keys are configured later.
  const eligibility = getOrderEligibility(order.gameSlug, order.serviceSlug);
  if (!eligibility.ok) throw new CheckoutError(NOT_PURCHASABLE_MESSAGE, 403);

  let stripe: Stripe;
  let appUrl: string;
  try {
    stripe = getStripe();
    appUrl = getAppUrl();
  } catch (e) {
    if (e instanceof StripeConfigError) throw new CheckoutError("Online payment is not available right now.", 503);
    throw e;
  }

  const now = Date.now();
  const attempt = await prisma
    .$transaction(async (tx) => {
      const open = await tx.payment.findUnique({ where: { openSlotOrderId: orderId } });
      if (open) {
        if (open.status === "OPEN" && open.checkoutUrl && open.checkoutExpiresAt && open.checkoutExpiresAt.getTime() > now + REUSE_MARGIN_MS) {
          return { reuse: open };
        }
        if (open.status === "PROCESSING") throw new CheckoutError("A payment for this order is still being processed.", 409);
        if (open.status === "CREATED" && open.createdAt.getTime() > now - STALE_CREATED_MS) {
          throw new CheckoutError("Checkout is being prepared. Try again in a moment.", 409);
        }
        // Expired or abandoned attempt: close it and release the slot.
        await tx.payment.update({
          where: { id: open.id, openSlotOrderId: orderId },
          data: { status: open.status === "OPEN" ? "EXPIRED" : "CANCELED", openSlotOrderId: null },
        });
        if (open.stripeCheckoutSessionId) {
          await enqueueOutbox(tx, [
            { type: "EXPIRE_CHECKOUT_SESSION", dedupeKey: `expire:${open.stripeCheckoutSessionId}`, payload: { sessionId: open.stripeCheckoutSessionId } },
          ]);
        }
      }
      const last = await tx.payment.findFirst({ where: { orderId }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true } });
      const attemptNumber = (last?.attemptNumber ?? 0) + 1;
      const created = await tx.payment.create({
        data: {
          orderId,
          customerId,
          attemptNumber,
          amount: snapshot.totalAmount,
          currency: snapshot.currency,
          status: "CREATED",
          openSlotOrderId: orderId,
          idempotencyKey: `checkout:${orderId}:${attemptNumber}`,
        },
      });
      return { create: created };
    })
    .catch((e) => {
      if ((e as { code?: string }).code === "P2002") throw new CheckoutError("Checkout is being prepared. Try again in a moment.", 409);
      throw e;
    });

  if ("reuse" in attempt && attempt.reuse) {
    return { url: attempt.reuse.checkoutUrl!, paymentId: attempt.reuse.id, reused: true };
  }
  const payment = attempt.create!;
  const offer = getGameServiceOffer(order.gameSlug, order.serviceSlug);
  const metadata = { orderId, paymentId: payment.id, customerId };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: orderId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: toStripeCurrency(snapshot.currency),
              unit_amount: snapshot.totalAmount,
              product_data: {
                name: offer?.title ?? `${order.gameSlug} ${order.serviceSlug}`,
                description: `Order ${orderId.slice(-8).toUpperCase()}`,
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(now / 1000) + SESSION_LIFETIME_S,
        success_url: `${appUrl}/checkout/success?orderId=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/checkout/cancelled?orderId=${encodeURIComponent(orderId)}`,
      },
      { idempotencyKey: payment.idempotencyKey }
    );
  } catch (e) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        openSlotOrderId: null,
        failureCode: "checkout_session_create_failed",
        failureMessage: safeErrorMessage(e),
        lastFailedAt: new Date(),
      },
    });
    throw new CheckoutError("Could not start the payment. Please try again.", 502);
  }

  // Defensive: Stripe must echo exactly the amount we asked for.
  if (session.amount_total !== snapshot.totalAmount || String(session.currency).toUpperCase() !== snapshot.currency || !session.url) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", openSlotOrderId: null, stripeCheckoutSessionId: session.id, failureCode: "checkout_session_mismatch", lastFailedAt: new Date() },
      });
      await enqueueOutbox(tx, [{ type: "EXPIRE_CHECKOUT_SESSION", dedupeKey: `expire:${session.id}`, payload: { sessionId: session.id } }]);
    });
    await dispatchOutbox({ limit: 5 });
    throw new CheckoutError("Could not start the payment. Please try again.", 502);
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "OPEN",
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
      checkoutExpiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    },
  });
  await dispatchOutbox({ limit: 5 });
  return { url: session.url, paymentId: payment.id, reused: false };
}

/** Payment state for the order owner (success / cancel pages). Read-only. */
export async function getOrderPaymentStatus(userId: string, role: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      pricingSnapshot: { select: { totalAmount: true, currency: true, discountAmount: true, breakdown: true } },
      payments: { orderBy: { attemptNumber: "desc" }, take: 1, select: { status: true, attemptNumber: true, failureCode: true, updatedAt: true } },
    },
  });
  if (!order || (role !== "ADMIN" && order.userId !== userId)) return null;
  const latest = order.payments[0] ?? null;
  return {
    orderId: order.id,
    orderStatus: order.status,
    paid: order.paymentVerifiedAt !== null,
    amount: order.pricingSnapshot?.totalAmount ?? null,
    currency: order.pricingSnapshot?.currency ?? null,
    latestPayment: latest
      ? { status: latest.status, attemptNumber: latest.attemptNumber, failed: latest.status === "FAILED" || latest.failureCode !== null, updatedAt: latest.updatedAt.toISOString() }
      : null,
    canPay: order.status === "AWAITING_PAYMENT" && order.paymentVerifiedAt === null && order.pricingSnapshot !== null && latest?.status !== "PROCESSING",
    /** What was bought, for the success page; only once the payment is confirmed. */
    summary: order.paymentVerifiedAt !== null ? buildOrderSummary(order) : null,
  };
}
