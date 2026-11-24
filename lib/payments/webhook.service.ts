/**
 * Stripe webhook processing.
 *
 *   1. verify the signature on the RAW body (STRIPE_WEBHOOK_SECRET);
 *   2. store the event (unique stripeEventId) BEFORE processing;
 *   3. process it in ONE database transaction that first claims the event
 *      row (RECEIVED/FAILED -> PROCESSED). A concurrent delivery of the same
 *      event blocks on that row and then sees it already processed;
 *   4. on error the transaction rolls back, the event is marked FAILED with
 *      a safe message and Stripe gets a 500 (it retries); admins can also
 *      retry it from the stored payload;
 *   5. side effects (notifications, fee lookup) go through the outbox and
 *      are dispatched after commit, so they can never lose a payment.
 *
 * Only a verified successful payment (this module) sets
 * Order.paymentVerifiedAt.
 */
import prisma from "@/lib/prisma";
import { confirmCashbackSpent } from "@/lib/cashback/service";
import type Stripe from "stripe";
import type { Prisma } from "@/app/generated/prisma/client";
import { constructWebhookEvent, fromStripeCurrency, getStripe, getWebhookSecret, liveModeAllowed, safeErrorMessage, StripeConfigError } from "@/lib/stripe/server";
import { postLedger } from "@/lib/finance/ledger";
import { reserveBoosterShare, holdEarningsForDispute, releaseDisputeHold } from "@/lib/finance/earnings";
import { postReversal, reconcileStripeRefund } from "@/lib/finance/refunds";
import { enqueueOutbox, notifyAdmins, dispatchOutbox } from "./outbox";
import { closeCheckoutHold } from "./checkout.service";
import { transitionOrder } from "@/lib/orders/transitions";
import { getConfigIn } from "@/lib/config";
import { applyTipPaid, isTipSession, markTipSession } from "@/lib/tips/service";

type Tx = Prisma.TransactionClient;
type Outcome = { outcome: string; ignored?: boolean; paymentId?: string | null };
type Prefetched = { refunds?: Stripe.Refund[] };

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

export interface WebhookResult {
  status: number;
  body: { received: boolean; duplicate?: boolean; outcome?: string; error?: string };
}

class AlreadyProcessed extends Error {}

export async function receiveStripeWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  let secret: string;
  try {
    secret = getWebhookSecret();
  } catch (e) {
    if (e instanceof StripeConfigError) return { status: 500, body: { received: false, error: "Webhook not configured" } };
    throw e;
  }
  if (!signature) return { status: 400, body: { received: false, error: "Missing signature" } };

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: { received: false, error: "Invalid signature" } };
  }

  let row = await prisma.paymentEvent.findUnique({ where: { stripeEventId: event.id } });
  if (!row) {
    try {
      row = await prisma.paymentEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          livemode: event.livemode,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      row = await prisma.paymentEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } });
    }
  }
  if (row.status === "PROCESSED" || row.status === "IGNORED") {
    return { status: 200, body: { received: true, duplicate: true, outcome: row.outcome ?? undefined } };
  }

  const result = await processStoredEvent(row.id);
  await dispatchOutbox({ limit: 20 });
  if (!result.ok) return { status: 500, body: { received: false, error: "Processing failed; will retry" } };
  return { status: 200, body: { received: true, duplicate: result.duplicate, outcome: result.outcome } };
}

/** Process (or re-process) a stored event. Used by the webhook and by admin retry. */
export async function processStoredEvent(eventRowId: string): Promise<{ ok: boolean; outcome?: string; duplicate?: boolean }> {
  const row = await prisma.paymentEvent.findUniqueOrThrow({ where: { id: eventRowId } });
  if (row.status === "PROCESSED" || row.status === "IGNORED") return { ok: true, duplicate: true, outcome: row.outcome ?? undefined };
  const event = row.payload as unknown as Stripe.Event;

  try {
    const prefetched = await prefetch(event);
    const out = await prisma.$transaction(
      async (tx) => {
        // Claim first: locks the row; a concurrent delivery waits here.
        const claimed = await tx.paymentEvent.updateMany({
          where: { id: row.id, status: { in: ["RECEIVED", "FAILED"] } },
          data: { status: "PROCESSED", attempts: { increment: 1 }, processedAt: new Date(), lastError: null },
        });
        if (claimed.count === 0) throw new AlreadyProcessed();
        const result = event.livemode && !liveModeAllowed()
          ? { outcome: "livemode_event_ignored", ignored: true }
          : await handle(tx, event, prefetched);
        await tx.paymentEvent.update({
          where: { id: row.id },
          data: { status: result.ignored ? "IGNORED" : "PROCESSED", outcome: result.outcome, paymentId: result.paymentId ?? undefined },
        });
        return result;
      },
      { timeout: 20_000 }
    );
    return { ok: true, outcome: out.outcome };
  } catch (e) {
    if (e instanceof AlreadyProcessed) return { ok: true, duplicate: true };
    await prisma.paymentEvent.update({
      where: { id: row.id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: safeErrorMessage(e) },
    });
    return { ok: false };
  }
}

/** Network calls happen before the transaction, never inside it. */
async function prefetch(event: Stripe.Event): Promise<Prefetched> {
  if (event.type !== "charge.refunded") return {};
  const charge = event.data.object as Stripe.Charge;
  const embedded = charge.refunds?.data;
  if (embedded && charge.refunds && !charge.refunds.has_more) return { refunds: embedded };
  try {
    const list = await getStripe().refunds.list({ charge: charge.id, limit: 100 });
    return { refunds: list.data };
  } catch {
    return { refunds: embedded ?? [] };
  }
}

async function handle(tx: Tx, event: Stripe.Event, prefetched: Prefetched): Promise<Outcome> {
  // Phase 8: tip sessions (metadata.kind = "tip") never touch order payments.
  if (event.type.startsWith("checkout.session.") && isTipSession(event.data.object as Stripe.Checkout.Session)) {
    const s = event.data.object as Stripe.Checkout.Session;
    if (event.type === "checkout.session.expired") return markTipSession(tx, s, "EXPIRED");
    if (event.type === "checkout.session.async_payment_failed") return markTipSession(tx, s, "FAILED");
    if (s.payment_status === "paid") return applyTipPaid(tx, s);
    return { outcome: "tip_not_paid_yet", ignored: true };
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status === "paid") return applySessionPaid(tx, s, event.id);
      if (s.payment_status === "unpaid") return markProcessing(tx, s);
      return flagSession(tx, s, "NO_PAYMENT_REQUIRED");
    }
    case "checkout.session.async_payment_succeeded":
      return applySessionPaid(tx, event.data.object as Stripe.Checkout.Session, event.id);
    case "checkout.session.async_payment_failed":
      return markSessionFailed(tx, event.data.object as Stripe.Checkout.Session, "async_payment_failed");
    case "checkout.session.expired":
      return markSessionExpired(tx, event.data.object as Stripe.Checkout.Session);
    case "payment_intent.payment_failed":
      return recordIntentFailure(tx, event.data.object as Stripe.PaymentIntent);
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const outcomes: string[] = [];
      for (const r of prefetched.refunds ?? []) outcomes.push((await reconcileStripeRefund(tx, refundShape(r))).outcome);
      return { outcome: outcomes.length ? outcomes.join(",") : "no_refunds_listed", paymentId: await paymentIdForIntent(tx, charge.payment_intent) };
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const r = event.data.object as Stripe.Refund;
      const out = await reconcileStripeRefund(tx, refundShape(r));
      return { outcome: out.outcome, ignored: out.outcome === "unknown_payment" };
    }
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      return handleDispute(tx, event.data.object as Stripe.Dispute);
    default:
      return { outcome: "unhandled_event_type", ignored: true };
  }
}

function refundShape(r: Stripe.Refund) {
  return {
    id: r.id,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    payment_intent: typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id ?? null,
    failure_reason: r.failure_reason ?? null,
    metadata: (r.metadata as Record<string, string> | null) ?? null,
  };
}

async function paymentIdForIntent(tx: Tx, pi: string | Stripe.PaymentIntent | null) {
  const id = typeof pi === "string" ? pi : pi?.id;
  if (!id) return null;
  return (await tx.payment.findUnique({ where: { stripePaymentIntentId: id }, select: { id: true } }))?.id ?? null;
}

/** Find the attempt for a session: by session id, else by metadata.paymentId. */
async function findPaymentForSession(tx: Tx, s: Stripe.Checkout.Session) {
  const bySession = await tx.payment.findUnique({ where: { stripeCheckoutSessionId: s.id } });
  if (bySession) return bySession;
  const metaId = s.metadata?.paymentId;
  if (!metaId) return null;
  const byMeta = await tx.payment.findUnique({ where: { id: metaId } });
  // Only adopt the session if the attempt has none yet (crash between
  // Stripe creation and our update); never re-point another session.
  if (byMeta && !byMeta.stripeCheckoutSessionId) {
    return tx.payment.update({ where: { id: byMeta.id }, data: { stripeCheckoutSessionId: s.id } });
  }
  return null;
}

function metadataMatches(s: Stripe.Checkout.Session, p: { id: string; orderId: string; customerId: string }) {
  const m = s.metadata ?? {};
  return m.paymentId === p.id && m.orderId === p.orderId && m.customerId === p.customerId && (s.client_reference_id ?? p.orderId) === p.orderId;
}

async function flagForReview(tx: Tx, paymentId: string, orderId: string, reason: string, data: Prisma.PaymentUpdateInput = {}) {
  await tx.payment.update({ where: { id: paymentId }, data: { ...data, reviewReason: reason } });
  await enqueueOutbox(tx, [notifyAdmins(`payment-review:${paymentId}:${reason}`, `payment needs review (${reason})`, orderId)]);
}

async function applySessionPaid(tx: Tx, s: Stripe.Checkout.Session, eventId: string): Promise<Outcome> {
  const payment = await findPaymentForSession(tx, s);
  if (!payment) return { outcome: "unknown_session", ignored: true };
  if (payment.status === "SUCCEEDED") return { outcome: "already_succeeded", paymentId: payment.id };

  const amount = s.amount_total ?? 0;
  const currency = fromStripeCurrency(s.currency);
  const intentId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
  const received: Prisma.PaymentUpdateInput = {
    status: "SUCCEEDED",
    succeededAt: new Date(),
    amountReceived: amount,
    openSlotOrderId: null,
    ...(intentId && !payment.stripePaymentIntentId ? { stripePaymentIntentId: intentId } : {}),
  };
  // Money that arrived but cannot be applied is still recorded (customer
  // account) so it can be refunded; it never publishes the order.
  const unapplied = async (reason: string): Promise<Outcome> => {
    await flagForReview(tx, payment.id, payment.orderId, reason, received);
    if (amount > 0 && /^[A-Z]{3}$/.test(currency)) {
      await postLedger(tx, [
        {
          type: "CUSTOMER_PAYMENT", account: "CUSTOMER_PAYMENTS", amount, currency,
          idempotencyKey: `payment:${payment.id}:customer_payment`, orderId: payment.orderId, paymentId: payment.id,
          description: `Unapplied payment (${reason})`,
        },
      ]);
    }
    return { outcome: `payment_needs_review_${reason.toLowerCase()}`, paymentId: payment.id };
  };

  if (!metadataMatches(s, payment)) return unapplied("METADATA_MISMATCH");

  const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { pricingSnapshot: true } });
  const snap = order.pricingSnapshot;
  if (order.userId !== payment.customerId) return unapplied("CUSTOMER_MISMATCH");
  if (!snap) return unapplied("NO_PRICE_SNAPSHOT");
  if (currency !== payment.currency || currency !== snap.currency) return unapplied("CURRENCY_MISMATCH");
  if (amount !== payment.amount || amount !== snap.totalAmount) return unapplied("AMOUNT_MISMATCH");
  if (order.paidPaymentId || order.paymentVerifiedAt) return unapplied("DUPLICATE_PAYMENT");
  if (order.status !== "AWAITING_PAYMENT") return unapplied("ORDER_NOT_PAYABLE");

  const now = new Date();
  const preferredMinutes = order.preferredBoosterId ? await getConfigIn(tx, "preferred_booster_window_min") : 0;
  await tx.payment.update({ where: { id: payment.id }, data: received });
  // The only place in the application that sets paymentVerifiedAt.
  // Conditional: exactly one payment can ever publish an order.
  await transitionOrder(tx, {
    where: { id: order.id, status: "AWAITING_PAYMENT", paymentVerifiedAt: null, AND: [{ paidPaymentId: { equals: null } }] },
    to: "PENDING",
    data: {
      paymentVerifiedAt: now,
      paidPaymentId: payment.id,
      // Customer-chosen booster: exclusive window starts now (lib/pool/preferred.ts).
      ...(order.preferredBoosterId ? { preferredUntil: new Date(now.getTime() + preferredMinutes * 60_000) } : {}),
    },
  });
  await postLedger(tx, [
    {
      type: "CUSTOMER_PAYMENT", account: "CUSTOMER_PAYMENTS", amount: snap.totalAmount, currency,
      idempotencyKey: `payment:${payment.id}:customer_payment`, orderId: order.id, paymentId: payment.id,
    },
    {
      type: "PLATFORM_COMMISSION", account: "PLATFORM_REVENUE", amount: snap.platformFeeAmount, currency,
      idempotencyKey: `payment:${payment.id}:platform_commission`, orderId: order.id, paymentId: payment.id,
      description: `${snap.platformFeeBps / 100}% platform commission`,
    },
    {
      type: "BOOSTER_SHARE_RESERVED", account: "BOOSTER_POOL", amount: snap.boosterShareAmount, currency,
      idempotencyKey: `payment:${payment.id}:booster_share`, orderId: order.id, paymentId: payment.id,
      description: `${snap.boosterShareBps / 100}% booster share`,
    },
  ]);
  await confirmCashbackSpent(tx, { orderId: order.id, paymentId: payment.id });
  await reserveBoosterShare(tx, order, snap);
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: "PAYMENT_CONFIRMED",
      message: "Payment confirmed; order published to boosters",
      metadata: { paymentId: payment.id, stripeEventId: eventId, amount, currency },
    },
  });
  await enqueueOutbox(tx, [
    {
      type: "NOTIFY",
      dedupeKey: `payment-succeeded:${payment.id}`,
      payload: { notification: "PAYMENT_SUCCEEDED", recipients: [order.userId], orderId: order.id, actorId: order.userId },
    },
    { type: "EMAIL_ORDER_CONFIRMED", dedupeKey: `order-confirmed-email:${order.id}`, payload: { orderId: order.id } },
    { type: "FETCH_STRIPE_FEE", dedupeKey: `stripe-fee:${payment.id}`, payload: { paymentId: payment.id } },
    // Live: the new order appears in boosters' available orders right away.
    { type: "POOL_SIGNAL", dedupeKey: `pool-added:${order.id}`, payload: { reason: "added" } },
    ...(order.preferredBoosterId
      ? [
          {
            type: "NOTIFY" as const,
            dedupeKey: `order-offered:${order.id}`,
            payload: {
              notification: "ORDER_OFFERED" as const,
              recipients: [order.preferredBoosterId],
              orderId: order.id,
              actorId: order.userId,
              metadata: { minutes: preferredMinutes },
            },
          },
        ]
      : []),
  ]);
  return { outcome: "payment_succeeded", paymentId: payment.id };
}

async function markProcessing(tx: Tx, s: Stripe.Checkout.Session): Promise<Outcome> {
  const payment = await findPaymentForSession(tx, s);
  if (!payment) return { outcome: "unknown_session", ignored: true };
  const intentId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
  const r = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["CREATED", "OPEN"] } },
    data: { status: "PROCESSING", ...(intentId && !payment.stripePaymentIntentId ? { stripePaymentIntentId: intentId } : {}) },
  });
  return { outcome: r.count ? "awaiting_async_payment" : "unchanged", paymentId: payment.id };
}

async function flagSession(tx: Tx, s: Stripe.Checkout.Session, reason: string): Promise<Outcome> {
  const payment = await findPaymentForSession(tx, s);
  if (!payment) return { outcome: "unknown_session", ignored: true };
  await flagForReview(tx, payment.id, payment.orderId, reason);
  return { outcome: `payment_needs_review_${reason.toLowerCase()}`, paymentId: payment.id };
}

async function markSessionFailed(tx: Tx, s: Stripe.Checkout.Session, code: string): Promise<Outcome> {
  const payment = await findPaymentForSession(tx, s);
  if (!payment) return { outcome: "unknown_session", ignored: true };
  const r = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["CREATED", "OPEN", "PROCESSING"] } },
    data: { status: "FAILED", openSlotOrderId: null, failureCode: code, failureMessage: "The payment did not complete.", lastFailedAt: new Date() },
  });
  if (r.count) {
    await tx.orderEvent.create({ data: { orderId: payment.orderId, type: "PAYMENT_FAILED", message: "Payment did not complete", metadata: { paymentId: payment.id, code } } });
    // No order exists for the customer until payment succeeds: close the hold.
    await closeCheckoutHold(tx, payment.orderId, `payment_${code}`);
    await enqueueOutbox(tx, [
      {
        type: "NOTIFY",
        dedupeKey: `payment-failed:${payment.id}`,
        payload: { notification: "PAYMENT_FAILED", recipients: [payment.customerId], orderId: payment.orderId, actorId: payment.customerId },
      },
    ]);
  }
  return { outcome: r.count ? "payment_failed" : "unchanged", paymentId: payment.id };
}

async function markSessionExpired(tx: Tx, s: Stripe.Checkout.Session): Promise<Outcome> {
  const payment = await findPaymentForSession(tx, s);
  if (!payment) return { outcome: "unknown_session", ignored: true };
  const r = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["CREATED", "OPEN"] } },
    data: { status: "EXPIRED", openSlotOrderId: null },
  });
  // Stripe session over without payment: close the hold (no-op if paid or
  // if a newer attempt is still processing).
  if (r.count) await closeCheckoutHold(tx, payment.orderId, "checkout_session_expired");
  return { outcome: r.count ? "session_expired" : "unchanged", paymentId: payment.id };
}

/**
 * A card attempt failed. Inside Stripe Checkout the customer can usually
 * retry on the same session, so the attempt is NOT closed here; the failure
 * is recorded, and closure comes from async_payment_failed / expired.
 */
async function recordIntentFailure(tx: Tx, pi: Stripe.PaymentIntent): Promise<Outcome> {
  const metaId = pi.metadata?.paymentId;
  const payment =
    (await tx.payment.findUnique({ where: { stripePaymentIntentId: pi.id } })) ??
    (metaId ? await tx.payment.findUnique({ where: { id: metaId } }) : null);
  if (!payment) return { outcome: "unknown_payment_intent", ignored: true };
  const err = pi.last_payment_error;
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      failureCode: (err?.decline_code ?? err?.code ?? "payment_failed").slice(0, 100),
      failureMessage: (err?.message ?? "The payment attempt failed.").slice(0, 300),
      lastFailedAt: new Date(),
      ...(payment.stripePaymentIntentId ? {} : { stripePaymentIntentId: pi.id }),
    },
  });
  return { outcome: "payment_attempt_failed", paymentId: payment.id };
}

async function handleDispute(tx: Tx, d: Stripe.Dispute): Promise<Outcome> {
  const intentId = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id ?? null;
  const payment = intentId ? await tx.payment.findUnique({ where: { stripePaymentIntentId: intentId } }) : null;
  if (!payment) return { outcome: "unknown_payment", ignored: true };

  const status = d.status === "won" ? "WON" : d.status === "lost" ? "LOST" : "OPEN";
  const existing = await tx.dispute.findUnique({ where: { stripeDisputeId: d.id } });
  const dispute = existing
    ? await tx.dispute.update({
        where: { id: existing.id },
        data: {
          stripeStatus: d.status,
          status,
          reason: d.reason ?? existing.reason,
          ...(status !== "OPEN" && !existing.closedAt ? { closedAt: new Date() } : {}),
        },
      })
    : await tx.dispute.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          stripeDisputeId: d.id,
          amount: d.amount,
          currency: fromStripeCurrency(d.currency),
          reason: d.reason ?? null,
          stripeStatus: d.status,
          status,
          evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
          ...(status !== "OPEN" ? { closedAt: new Date() } : {}),
        },
      });

  if (!existing) {
    await tx.orderEvent.create({ data: { orderId: payment.orderId, type: "DISPUTE_OPENED", message: `Payment disputed (${d.reason ?? "unknown reason"})`, metadata: { disputeId: dispute.id } } });
    await enqueueOutbox(tx, [notifyAdmins(`dispute-opened:${dispute.id}`, `payment disputed (${d.reason ?? "unknown reason"})`, payment.orderId)]);
  }
  if (status === "OPEN") {
    await holdEarningsForDispute(tx, payment.orderId);
    return { outcome: existing ? "dispute_updated" : "dispute_opened", paymentId: payment.id };
  }
  if (status === "WON") {
    await releaseDisputeHold(tx, payment.orderId);
    return { outcome: "dispute_won", paymentId: payment.id };
  }
  // LOST: post the loss once.
  if (!dispute.lossPostedAt) {
    await postReversal(tx, { kind: "DISPUTE_LOSS", paymentId: payment.id, amount: dispute.amount, keyPrefix: `dispute:${dispute.id}`, disputeId: dispute.id });
    await tx.dispute.update({ where: { id: dispute.id, lossPostedAt: null }, data: { lossPostedAt: new Date() } });
    await enqueueOutbox(tx, [notifyAdmins(`dispute-lost:${dispute.id}`, "a dispute was lost; booster earnings were reversed", payment.orderId)]);
  }
  return { outcome: "dispute_lost", paymentId: payment.id };
}
