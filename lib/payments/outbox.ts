/**
 * Transactional outbox for side effects of financial events.
 *
 * Outbox rows are written in the SAME transaction as the financial change,
 * then dispatched after commit. A failing notification or Stripe lookup is
 * retried with back-off and can never undo, block or lose the payment that
 * caused it. Dispatch runs after each webhook / financial action and can be
 * triggered by an admin (POST /api/admin/finance/outbox).
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { createNotification } from "@/lib/notifications/service";
import type { NotificationEventType } from "@/lib/notifications/types";
import { getStripe, safeErrorMessage } from "@/lib/stripe/server";
import { postLedger } from "@/lib/finance/ledger";

export const OUTBOX_MAX_ATTEMPTS = 6;

export type OutboxMessage =
  | {
      type: "NOTIFY";
      payload: {
        notification: NotificationEventType;
        /** Explicit user ids, or "ADMINS" for every admin. */
        recipients: string[] | "ADMINS";
        orderId?: string | null;
        actorId: string;
        metadata?: Record<string, unknown>;
      };
    }
  | { type: "EXPIRE_CHECKOUT_SESSION"; payload: { sessionId: string } }
  | { type: "FETCH_STRIPE_FEE"; payload: { paymentId: string } }
  /** Live update: tell boosters the pool changed (no order data). */
  | { type: "POOL_SIGNAL"; payload: { reason: "added" | "removed" } }
  /** Live update: these users' open pages reload their data (e.g. a booster's balance after a refund). */
  | { type: "USER_SIGNAL"; payload: { userIds: string[]; scope: string } }
  /** "Order confirmed" email to the customer (once per paid order). */
  | { type: "EMAIL_ORDER_CONFIRMED"; payload: { orderId: string } }
  /** "Please confirm" email when a booster completes with proof. */
  | { type: "EMAIL_COMPLETION_SUBMITTED"; payload: { requestId: string } }
  /** "Your customer needs your attention" email to the booster (Poke booster). */
  | { type: "EMAIL_BOOSTER_POKE"; payload: { orderId: string; boosterId: string } }
  /** "The customer paused your order" email to the assigned booster. */
  | { type: "EMAIL_ORDER_PAUSED"; payload: { orderId: string; boosterId: string } }
  /** Stalled order: 2 h warning, final warning, "order taken back" (lib/boosters/stall.ts). */
  | { type: "EMAIL_BOOSTER_STALL"; payload: import("@/lib/email/booster-stall").StallEmailPayload };

export async function enqueueOutbox(
  tx: Prisma.TransactionClient,
  messages: (OutboxMessage & { dedupeKey: string })[]
): Promise<void> {
  if (messages.length === 0) return;
  await tx.outboxEvent.createMany({
    data: messages.map((m) => ({ type: m.type, payload: m.payload as Prisma.InputJsonValue, dedupeKey: m.dedupeKey })),
    skipDuplicates: true,
  });
}

export function notifyAdmins(dedupeKey: string, reason: string, orderId?: string | null, actorId = "system") {
  return {
    type: "NOTIFY" as const,
    dedupeKey,
    payload: {
      notification: "FINANCE_ALERT" as const,
      recipients: "ADMINS" as const,
      orderId: orderId ?? null,
      actorId,
      metadata: { reason },
    },
  };
}

type Handler = (payload: never, dedupeKey: string) => Promise<void>;

const handlers: Record<OutboxMessage["type"], Handler> = {
  EMAIL_ORDER_CONFIRMED: (async (p: { orderId: string }) => {
    const { sendOrderConfirmedEmail } = await import("@/lib/email/order-confirmed");
    await sendOrderConfirmedEmail(p.orderId);
  }) as Handler,
  EMAIL_COMPLETION_SUBMITTED: (async (p: { requestId: string }) => {
    const { sendCompletionSubmittedEmail } = await import("@/lib/email/completion-submitted");
    await sendCompletionSubmittedEmail(p.requestId);
  }) as Handler,
  EMAIL_BOOSTER_POKE: (async (p: { orderId: string; boosterId: string }) => {
    const { sendBoosterPokeEmail } = await import("@/lib/email/booster-poke");
    await sendBoosterPokeEmail(p.orderId, p.boosterId);
  }) as Handler,
  EMAIL_ORDER_PAUSED: (async (p: { orderId: string; boosterId: string }) => {
    const { sendOrderPausedEmail } = await import("@/lib/email/order-paused");
    await sendOrderPausedEmail(p.orderId, p.boosterId);
  }) as Handler,
  EMAIL_BOOSTER_STALL: (async (p: import("@/lib/email/booster-stall").StallEmailPayload) => {
    const { sendBoosterStallEmail } = await import("@/lib/email/booster-stall");
    await sendBoosterStallEmail(p);
  }) as Handler,
  POOL_SIGNAL: (async (p: Extract<OutboxMessage, { type: "POOL_SIGNAL" }>["payload"]) => {
    const { signalPool } = await import("@/lib/realtime/live");
    await signalPool(p.reason);
  }) as Handler,
  USER_SIGNAL: (async (p: Extract<OutboxMessage, { type: "USER_SIGNAL" }>["payload"]) => {
    const { signalUsers } = await import("@/lib/realtime/live");
    await signalUsers(p.userIds, p.scope);
  }) as Handler,
  NOTIFY: (async (p: Extract<OutboxMessage, { type: "NOTIFY" }>["payload"], dedupeKey: string) => {
    let recipients: string[];
    if (p.recipients === "ADMINS") {
      const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
      recipients = admins.map((a) => a.id);
    } else {
      recipients = p.recipients;
    }
    for (const userId of recipients) {
      await createNotification(userId, p.notification, p.orderId ?? undefined, p.metadata, p.actorId, {
        includeActor: true,
        // Same key as the outbox row: a retried dispatch never notifies twice.
        dedupeKey: `outbox:${dedupeKey}`,
      });
    }
  }) as Handler,

  EXPIRE_CHECKOUT_SESSION: (async (p: { sessionId: string }) => {
    try {
      await getStripe().checkout.sessions.expire(p.sessionId);
    } catch (e) {
      // Already expired or completed: nothing left to do.
      const code = (e as { code?: string; type?: string }).code;
      const type = (e as { type?: string }).type;
      if (type === "StripeInvalidRequestError" && (code === "resource_missing" || code === undefined)) return;
      throw e;
    }
  }) as Handler,

  FETCH_STRIPE_FEE: (async (p: { paymentId: string }) => {
    const payment = await prisma.payment.findUnique({ where: { id: p.paymentId } });
    if (!payment?.stripePaymentIntentId || payment.stripeFeeAmount !== null) return;
    const pi = await getStripe().paymentIntents.retrieve(payment.stripePaymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    if (!charge || !bt) throw new Error("Balance transaction not available yet");
    const fee = bt.fee;
    const feeCurrency = String(bt.currency).toUpperCase();
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { stripeFeeAmount: fee, stripeChargeId: payment.stripeChargeId ?? charge.id },
      });
      // Processing fees are a platform cost; they never reduce booster earnings.
      await postLedger(tx, [
        {
          type: "STRIPE_FEE",
          account: "STRIPE_FEES",
          amount: fee,
          currency: feeCurrency,
          idempotencyKey: `payment:${payment.id}:stripe_fee`,
          orderId: payment.orderId,
          paymentId: payment.id,
          description: "Stripe processing fee",
        },
      ]);
    });
  }) as Handler,
};

/** Dispatch due outbox rows. Never throws. */
export async function dispatchOutbox(opts: { limit?: number } = {}): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  try {
    const due = await prisma.outboxEvent.findMany({
      where: { status: "PENDING", availableAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: opts.limit ?? 20,
    });
    for (const row of due) {
      // Claim: only one dispatcher processes a row.
      const claimed = await prisma.outboxEvent.updateMany({
        where: { id: row.id, status: "PENDING", attempts: row.attempts },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      const handler = handlers[row.type as OutboxMessage["type"]];
      try {
        if (!handler) throw new Error(`Unknown outbox type ${row.type}`);
        await handler(row.payload as never, row.dedupeKey);
        await prisma.outboxEvent.update({ where: { id: row.id }, data: { status: "DONE", processedAt: new Date(), lastError: null } });
        done++;
      } catch (e) {
        const attempts = row.attempts + 1;
        const terminal = attempts >= OUTBOX_MAX_ATTEMPTS;
        await prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: terminal ? "FAILED" : "PENDING",
            lastError: safeErrorMessage(e),
            availableAt: new Date(Date.now() + Math.min(60_000 * 2 ** attempts, 6 * 3600_000)),
          },
        });
        failed++;
      }
    }
  } catch {
    // Dispatch is best effort; rows stay PENDING for the next run.
  }
  return { done, failed };
}

/** Admin: put FAILED rows back in the queue. */
export async function requeueFailedOutbox(): Promise<number> {
  const r = await prisma.outboxEvent.updateMany({
    where: { status: "FAILED" },
    data: { status: "PENDING", attempts: 0, availableAt: new Date() },
  });
  return r.count;
}
