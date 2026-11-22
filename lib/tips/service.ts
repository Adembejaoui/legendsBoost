// Server-only module.
/**
 * Tips (Phase 8, decisions 2026-11-16).
 *
 *  - The customer tips the booster through Stripe Checkout (1 to 500 in the
 *    order currency): while the order is Processing (the booster holding it,
 *    client PDF 2026-11-22) or once it is COMPLETED (the booster who completed it).
 *  - Split like an order (same commission policy): platform commission +
 *    booster share. Ledger on payment: CUSTOMER_PAYMENTS = PLATFORM_REVENUE +
 *    BOOSTER_PAYABLE. The booster share becomes a PENDING earning, released by
 *    an admin like any other earning, then paid out normally.
 *  - Tip sessions are routed by metadata.kind = "tip" in the Stripe webhook;
 *    order payments are untouched.
 */
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getAppUrl, getStripe, toStripeCurrency } from "@/lib/stripe/server";
import { getActiveCommissionPolicy } from "@/lib/pricing/service";
import { bpsOfFloor, formatMoney } from "@/lib/money";
import { postLedger } from "@/lib/finance/ledger";
import { enqueueOutbox } from "@/lib/payments/outbox";

type Tx = Prisma.TransactionClient;

export const TIP_MIN = 100;
export const TIP_MAX = 50_000;

export class TipError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "TipError";
  }
}

/** Booster share and platform commission of a tip (same policy as orders). */
export function splitTip(amount: number, boosterShareBps: number) {
  const boosterAmount = bpsOfFloor(amount, boosterShareBps);
  return { boosterAmount, platformFeeAmount: amount - boosterAmount };
}

/** Order statuses in which the customer can tip (Processing and Completed). */
export const TIPPABLE_ORDER = ["CLAIMED", "IN_PROGRESS", "PAUSED", "AWAITING_CONFIRMATION", "COMPLETED"] as const;
/** Assignment statuses of the booster holding a Processing order. */
const TIPPABLE_ASSIGNMENT = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED", "SUBMITTED"] as const;

export async function createTipCheckout(customerId: string, orderId: string, amount: number): Promise<{ url: string; tipId: string }> {
  if (!Number.isSafeInteger(amount) || amount < TIP_MIN || amount > TIP_MAX) {
    throw new TipError(`Choose a tip between ${TIP_MIN / 100} and ${TIP_MAX / 100}.`, 400);
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      status: true,
      currency: true,
      pricingSnapshot: { select: { currency: true } },
      assignments: {
        where: { status: { in: ["COMPLETED", ...TIPPABLE_ASSIGNMENT] } },
        select: { boosterId: true, status: true },
      },
    },
  });
  if (!order || order.userId !== customerId) throw new TipError("Order not found.", 404);
  if (!(TIPPABLE_ORDER as readonly string[]).includes(order.status)) {
    throw new TipError("You can tip once a booster is working on your order.", 409);
  }
  const boosterId =
    order.status === "COMPLETED"
      ? order.assignments.find((a) => a.status === "COMPLETED")?.boosterId
      : order.assignments.find((a) => (TIPPABLE_ASSIGNMENT as readonly string[]).includes(a.status))?.boosterId;
  if (!boosterId) throw new TipError("This order has no booster to tip.", 409);
  const policy = await getActiveCommissionPolicy();
  if (!policy) throw new TipError("Tips are not available right now.", 503);
  const currency = order.pricingSnapshot?.currency ?? order.currency ?? "EUR";
  const split = splitTip(amount, policy.boosterShareBps);

  const tip = await prisma.orderTip.create({
    data: { orderId, customerId, boosterId, amount, currency, ...split, idempotencyKey: `tip-${randomUUID()}` },
  });
  const appUrl = getAppUrl();
  const metadata = { kind: "tip", tipId: tip.id, orderId, customerId };
  const session = await getStripe().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: orderId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: toStripeCurrency(currency),
            unit_amount: amount,
            product_data: { name: "Tip for your booster", description: `Order ${orderId.slice(-8).toUpperCase()}` },
          },
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${appUrl}/dashboard/${encodeURIComponent(orderId)}?tip=thanks`,
      cancel_url: `${appUrl}/dashboard/${encodeURIComponent(orderId)}`,
    },
    { idempotencyKey: tip.idempotencyKey }
  );
  await prisma.orderTip.update({ where: { id: tip.id }, data: { stripeSessionId: session.id } });
  if (!session.url) throw new TipError("Stripe did not return a payment page.", 502);
  return { url: session.url, tipId: tip.id };
}

export function isTipSession(s: Stripe.Checkout.Session): boolean {
  return s.metadata?.kind === "tip";
}

async function findTip(tx: Tx, s: Stripe.Checkout.Session) {
  return (
    (await tx.orderTip.findUnique({ where: { stripeSessionId: s.id } })) ??
    (s.metadata?.tipId ? await tx.orderTip.findUnique({ where: { id: s.metadata.tipId } }) : null)
  );
}

/** Webhook: a tip session was paid. Idempotent (status + ledger keys). */
export async function applyTipPaid(tx: Tx, s: Stripe.Checkout.Session): Promise<{ outcome: string; ignored?: boolean }> {
  const tip = await findTip(tx, s);
  if (!tip) return { outcome: "tip_unknown", ignored: true };
  if (tip.status === "PAID") return { outcome: "tip_already_paid", ignored: true };
  const paid = s.amount_total ?? 0;
  const currency = (s.currency ?? "").toUpperCase();
  if (paid !== tip.amount || currency !== tip.currency || s.metadata?.orderId !== tip.orderId) {
    return { outcome: "tip_mismatch", ignored: true };
  }
  const moved = await tx.orderTip.updateMany({
    where: { id: tip.id, status: { in: ["PENDING", "EXPIRED", "FAILED"] } },
    data: { status: "PAID", paidAt: new Date(), stripeSessionId: s.id },
  });
  if (moved.count === 0) return { outcome: "tip_already_paid", ignored: true };
  const policy = await getActiveCommissionPolicy(tx);
  await postLedger(tx, [
    { type: "TIP_PAYMENT", account: "CUSTOMER_PAYMENTS", amount: tip.amount, currency: tip.currency, idempotencyKey: `tip:${tip.id}:customer`, orderId: tip.orderId, description: "Customer tip" },
    { type: "TIP_COMMISSION", account: "PLATFORM_REVENUE", amount: tip.platformFeeAmount, currency: tip.currency, idempotencyKey: `tip:${tip.id}:platform`, orderId: tip.orderId, description: "Commission on a tip" },
    {
      type: "TIP_BOOSTER_SHARE", account: "BOOSTER_PAYABLE", amount: tip.boosterAmount, currency: tip.currency, idempotencyKey: `tip:${tip.id}:booster`,
      orderId: tip.orderId, boosterId: tip.boosterId, description: "Booster share of a tip",
    },
  ]);
  if (tip.boosterAmount > 0) {
    await tx.boosterEarning.create({
      data: {
        orderId: tip.orderId,
        boosterId: tip.boosterId,
        grossAmount: tip.boosterAmount,
        currency: tip.currency,
        platformFeeBps: policy?.platformFeeBps ?? 0,
        boosterShareBps: policy?.boosterShareBps ?? 10_000,
        status: "PENDING",
        allocationNote: "Tip from the customer",
      },
    });
  }
  await tx.orderEvent.create({ data: { orderId: tip.orderId, type: "TIP_PAID", message: "The customer tipped the booster", metadata: { tipId: tip.id, amount: tip.amount, currency: tip.currency } } });
  await enqueueOutbox(tx, [
    {
      type: "NOTIFY",
      dedupeKey: `tip:${tip.id}`,
      payload: {
        notification: "TIP_RECEIVED",
        recipients: [tip.boosterId],
        orderId: tip.orderId,
        actorId: tip.customerId,
        metadata: { amount: formatMoney(tip.boosterAmount, tip.currency) },
      },
    },
  ]);
  return { outcome: "tip_paid" };
}

/** Webhook: a tip session expired or failed. */
export async function markTipSession(tx: Tx, s: Stripe.Checkout.Session, status: "EXPIRED" | "FAILED") {
  const tip = await findTip(tx, s);
  if (!tip) return { outcome: "tip_unknown", ignored: true };
  const r = await tx.orderTip.updateMany({ where: { id: tip.id, status: "PENDING" }, data: { status } });
  return { outcome: r.count ? `tip_${status.toLowerCase()}` : "tip_unchanged", ignored: r.count === 0 };
}
