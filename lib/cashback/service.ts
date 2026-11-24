// Server-only module.
/**
 * Customer cashback (2026-11-24).
 *
 *   Earn    an order is completed -> `cashback_rate_bps` (5 %) of the amount
 *           actually paid (minus refunds so far), expiring after
 *           `cashback_expiry_days` (180).
 *   Spend   at order creation, inside the order transaction, under a
 *           per-customer lock, so two checkouts can never spend the same
 *           credit. At most `cashback_max_order_bps` (50 %) of the order and
 *           never more than the platform fee (it never lowers the booster share).
 *   Release the unpaid checkout closes -> the credit comes back (same expiry).
 *   Refund  earned cashback is taken back in proportion to the refund; used
 *           cashback is given back in proportion to the refund.
 *   Expire  a scheduled job closes the unspent part of expired credit.
 *   Adjust  an admin adds or removes credit, with a reason (audited).
 *
 * Every change is a new row in the append-only `cashbackEntry` table (with a
 * unique idempotency key, checked before inserting) plus ledger postings
 * that move CUSTOMER_CREDIT and PLATFORM_REVENUE in opposite directions. The
 * only exception is the checkout reservation: posted to the ledger when the
 * payment is confirmed, so an unpaid checkout never touches the ledger.
 */
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getConfig, getConfigIn } from "@/lib/config";
import { cumulativeShare, normalizeCurrency } from "@/lib/money";
import { postLedger, type LedgerTransactionType } from "@/lib/finance/ledger";
import { writeAudit } from "@/lib/finance/audit";
import { logger } from "@/lib/logger";
import { cashbackState, expiredLots, spendExpiry, type CashbackEntryLike, type CashbackState } from "./state";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const DAY = 86_400_000;
/** Credit given back after a refund lasts at least this long. */
const MIN_RETURN_DAYS = 30;
/** The expiry job looks back this far (it runs every 15 minutes). */
const EXPIRY_LOOKBACK_DAYS = 30;

export class CashbackError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
    this.name = "CashbackError";
  }
}

export interface CashbackSettings {
  enabled: boolean;
  rateBps: number;
  maxOrderBps: number;
  expiryDays: number;
}

export async function cashbackSettings(db?: Tx): Promise<CashbackSettings> {
  const read = <K extends "cashback_enabled" | "cashback_rate_bps" | "cashback_max_order_bps" | "cashback_expiry_days">(k: K) =>
    db ? getConfigIn(db, k) : getConfig(k);
  const [enabled, rateBps, maxOrderBps, expiryDays] = await Promise.all([
    read("cashback_enabled"),
    read("cashback_rate_bps"),
    read("cashback_max_order_bps"),
    read("cashback_expiry_days"),
  ]);
  return { enabled, rateBps, maxOrderBps, expiryDays };
}

const ENTRY_SELECT = { id: true, kind: true, amount: true, expiresAt: true, lotId: true, createdAt: true } as const;

async function loadEntries(db: Db, userId: string, currency: string): Promise<CashbackEntryLike[]> {
  return db.cashbackEntry.findMany({
    where: { userId, currency: normalizeCurrency(currency) },
    select: ENTRY_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Serialises every cashback change of one customer (transaction-scoped
 * advisory lock, released at commit or rollback).
 */
async function lockCustomer(tx: Tx, userId: string) {
  // $executeRaw: the function returns void, which a query cannot read back.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cashback:${userId}`}, 0))`;
}

async function exists(db: Db, idempotencyKey: string) {
  return (await db.cashbackEntry.findUnique({ where: { idempotencyKey }, select: { id: true } })) !== null;
}

/** CUSTOMER_CREDIT moves by `credit`; PLATFORM_REVENUE by the opposite. */
async function postCashbackLedger(
  tx: Tx,
  p: { type: LedgerTransactionType; credit: number; currency: string; key: string; orderId?: string | null; refundId?: string | null; paymentId?: string | null; description: string; createdById?: string | null }
) {
  await postLedger(tx, [
    {
      type: p.type, account: "CUSTOMER_CREDIT", amount: p.credit, currency: p.currency, idempotencyKey: `${p.key}:credit`,
      orderId: p.orderId ?? null, refundId: p.refundId ?? null, paymentId: p.paymentId ?? null, description: p.description, createdById: p.createdById ?? null,
    },
    {
      type: p.type, account: "PLATFORM_REVENUE", amount: -p.credit, currency: p.currency, idempotencyKey: `${p.key}:platform`,
      orderId: p.orderId ?? null, refundId: p.refundId ?? null, paymentId: p.paymentId ?? null, description: p.description, createdById: p.createdById ?? null,
    },
  ]);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** What a customer can spend in one currency right now. */
export async function availableCashback(userId: string, currency: string, db: Db = prisma, now = new Date()): Promise<number> {
  return cashbackState(await loadEntries(db, userId, currency), now).available;
}

export interface CashbackBalance {
  currency: string;
  available: number;
  /** Live credit that expires within 30 days. */
  expiringSoon: number;
  nextExpiry: string | null;
}

/** Customer dashboard: balance per currency and the latest history. */
export async function cashbackSummary(userId: string, now = new Date()) {
  const entries = await prisma.cashbackEntry.findMany({
    where: { userId },
    select: { ...ENTRY_SELECT, currency: true, orderId: true, note: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byCurrency = new Map<string, CashbackEntryLike[]>();
  for (const e of entries) byCurrency.set(e.currency, [...(byCurrency.get(e.currency) ?? []), e]);
  const soon = new Date(now.getTime() + 30 * DAY);
  const balances: CashbackBalance[] = [...byCurrency.entries()].map(([currency, list]) => {
    const st: CashbackState = cashbackState(list, now);
    const liveLots = st.lots.filter((l) => l.remaining > 0 && (l.expiresAt === null || l.expiresAt > now));
    const expiring = liveLots.filter((l) => l.expiresAt && l.expiresAt <= soon);
    const next = liveLots.map((l) => l.expiresAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    return { currency, available: st.available, expiringSoon: Math.min(st.available, expiring.reduce((s, l) => s + l.remaining, 0)), nextExpiry: next?.toISOString() ?? null };
  });
  const history = entries
    .slice(-50)
    .reverse()
    .map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, currency: e.currency, orderId: e.orderId, note: e.kind === "ADJUST" ? e.note : null, at: e.createdAt.toISOString(), expiresAt: e.amount > 0 ? e.expiresAt?.toISOString() ?? null : null }));
  return { balances: balances.filter((b) => b.available > 0 || history.some((h) => h.currency === b.currency)), history };
}

/* ------------------------------------------------------------------ */
/* Spend (order creation) and release (unpaid checkout closed)          */
/* ------------------------------------------------------------------ */

/**
 * Reserve `amount` for an order being created, in the order transaction.
 * Re-checks the balance under the customer lock: if it dropped since the
 * quote (another checkout, a refund), the order is refused with 409.
 */
export async function reserveCashback(tx: Tx, p: { userId: string; orderId: string; currency: string; amount: number; now?: Date }) {
  if (!Number.isSafeInteger(p.amount) || p.amount <= 0) return;
  const now = p.now ?? new Date();
  await lockCustomer(tx, p.userId);
  const state = cashbackState(await loadEntries(tx, p.userId, p.currency), now);
  if (state.available < p.amount) throw new CashbackError("Your cashback balance changed. Please review the new total before confirming.", 409);
  await tx.cashbackEntry.create({
    data: {
      userId: p.userId,
      currency: normalizeCurrency(p.currency),
      kind: "SPEND",
      amount: -p.amount,
      expiresAt: spendExpiry(state, p.amount, now),
      orderId: p.orderId,
      idempotencyKey: `cashback:spend:${p.orderId}`,
    },
  });
}

/** Unpaid checkout closed: give the reserved credit back (same expiry). Idempotent. */
export async function releaseCashbackForOrder(tx: Tx, orderId: string) {
  const spend = await tx.cashbackEntry.findUnique({ where: { idempotencyKey: `cashback:spend:${orderId}` } });
  if (!spend) return;
  const key = `cashback:release:${orderId}`;
  if (await exists(tx, key)) return;
  await lockCustomer(tx, spend.userId);
  await tx.cashbackEntry.create({
    data: { userId: spend.userId, currency: spend.currency, kind: "RELEASE", amount: -spend.amount, expiresAt: spend.expiresAt, orderId, idempotencyKey: key },
  });
}

/** Payment confirmed: the reserved credit is now spent (ledger). Idempotent. */
export async function confirmCashbackSpent(tx: Tx, p: { orderId: string; paymentId: string }) {
  const spend = await tx.cashbackEntry.findUnique({ where: { idempotencyKey: `cashback:spend:${p.orderId}` } });
  if (!spend || (await exists(tx, `cashback:release:${p.orderId}`))) return;
  await postCashbackLedger(tx, {
    type: "CASHBACK_SPENT",
    credit: spend.amount,
    currency: spend.currency,
    key: `payment:${p.paymentId}:cashback_spent`,
    orderId: p.orderId,
    paymentId: p.paymentId,
    description: "Cashback used on this order",
  });
}

/* ------------------------------------------------------------------ */
/* Earn (order completed)                                              */
/* ------------------------------------------------------------------ */

/** In the completion transaction: credit the customer once per order. */
export async function earnCashbackOnCompletion(tx: Tx, orderId: string, now = new Date()) {
  const key = `cashback:earn:${orderId}`;
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      paymentVerifiedAt: true,
      paidPaymentId: true,
      pricingSnapshot: { select: { totalAmount: true, currency: true } },
      paidPayment: { select: { amountRefunded: true } },
      user: { select: { role: true } },
    },
  });
  // Only paid customer orders earn (checked first: nothing else is read otherwise).
  if (!order?.paymentVerifiedAt || !order.paidPaymentId || !order.pricingSnapshot || order.user?.role !== "CUSTOMER") return null;
  if (await exists(tx, key)) return null;
  const settings = await cashbackSettings(tx);
  if (!settings.enabled || settings.rateBps <= 0) return null;
  // On what the customer actually paid (cash, not cashback), minus refunds so far.
  const paid = Math.max(0, order.pricingSnapshot.totalAmount - (order.paidPayment?.amountRefunded ?? 0));
  const amount = Math.floor((paid * settings.rateBps) / 10_000);
  if (amount <= 0) return null;
  const currency = order.pricingSnapshot.currency;
  await lockCustomer(tx, order.userId);
  await tx.cashbackEntry.create({
    data: {
      userId: order.userId, currency, kind: "EARN", amount, rateBps: settings.rateBps, orderId,
      expiresAt: new Date(now.getTime() + settings.expiryDays * DAY), idempotencyKey: key,
    },
  });
  await postCashbackLedger(tx, { type: "CASHBACK_EARNED", credit: amount, currency, key, orderId, description: `Cashback ${settings.rateBps / 100}% earned` });
  return { amount, currency, userId: order.userId };
}

/* ------------------------------------------------------------------ */
/* Refunds and lost disputes                                           */
/* ------------------------------------------------------------------ */

/**
 * Called by the refund / dispute reversal (lib/finance/refunds.ts), in its
 * transaction. `before` = customer money already returned before this one,
 * `paidTotal` = the cash the order was paid with.
 *   - earned cashback is taken back at its rate on the amount returned
 *     (refunds and lost disputes);
 *   - cashback used on the order is given back in proportion (refunds only:
 *     a chargeback does not return credit).
 */
export async function cashbackOnReversal(
  tx: Tx,
  p: { kind: "REFUND" | "DISPUTE_LOSS"; orderId: string; amount: number; before: number; paidTotal: number; keyPrefix: string; refundId?: string | null; now?: Date }
) {
  if (p.amount <= 0) return;
  const now = p.now ?? new Date();
  const [earn, spend] = await Promise.all([
    tx.cashbackEntry.findUnique({ where: { idempotencyKey: `cashback:earn:${p.orderId}` } }),
    tx.cashbackEntry.findUnique({ where: { idempotencyKey: `cashback:spend:${p.orderId}` } }),
  ]);
  if (!earn && !spend) return;
  await lockCustomer(tx, (earn ?? spend)!.userId);

  if (earn && earn.rateBps) {
    const key = `${p.keyPrefix}:cashback_reverse`;
    if (!(await exists(tx, key))) {
      const reversed = await tx.cashbackEntry.aggregate({ _sum: { amount: true }, where: { orderId: p.orderId, kind: "REVERSE" } });
      const left = earn.amount + (reversed._sum.amount ?? 0);
      const take = Math.min(left, Math.floor((p.amount * earn.rateBps) / 10_000));
      if (take > 0) {
        await tx.cashbackEntry.create({
          data: { userId: earn.userId, currency: earn.currency, kind: "REVERSE", amount: -take, orderId: p.orderId, refundId: p.refundId ?? null, idempotencyKey: key },
        });
        await postCashbackLedger(tx, { type: "CASHBACK_REVERSED", credit: -take, currency: earn.currency, key, orderId: p.orderId, refundId: p.refundId, description: "Cashback taken back after a refund" });
      }
    }
  }

  if (p.kind === "REFUND" && spend && p.paidTotal > 0 && !(await exists(tx, `cashback:release:${p.orderId}`))) {
    const key = `${p.keyPrefix}:cashback_return`;
    if (!(await exists(tx, key))) {
      const used = -spend.amount;
      const returned = await tx.cashbackEntry.aggregate({ _sum: { amount: true }, where: { orderId: p.orderId, kind: "RETURN" } });
      const share = cumulativeShare(used, p.before + p.amount, p.paidTotal) - cumulativeShare(used, p.before, p.paidTotal);
      const give = Math.min(share, used - (returned._sum.amount ?? 0));
      if (give > 0) {
        const minExpiry = new Date(now.getTime() + MIN_RETURN_DAYS * DAY);
        const expiresAt = spend.expiresAt === null ? null : spend.expiresAt > minExpiry ? spend.expiresAt : minExpiry;
        await tx.cashbackEntry.create({
          data: { userId: spend.userId, currency: spend.currency, kind: "RETURN", amount: give, expiresAt, orderId: p.orderId, refundId: p.refundId ?? null, idempotencyKey: key },
        });
        await postCashbackLedger(tx, { type: "CASHBACK_RETURNED", credit: give, currency: spend.currency, key, orderId: p.orderId, refundId: p.refundId, description: "Cashback given back after a refund" });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Expiry (scheduled job)                                              */
/* ------------------------------------------------------------------ */

/** Close the unspent part of expired credit. Idempotent; small batches. */
export async function expireCashback(now = new Date(), limit = 100) {
  const candidates = await prisma.cashbackEntry.findMany({
    where: { amount: { gt: 0 }, expiresAt: { lte: now, gte: new Date(now.getTime() - EXPIRY_LOOKBACK_DAYS * DAY) }, expirations: { none: {} } },
    select: { userId: true, currency: true },
    distinct: ["userId", "currency"],
    take: limit,
  });
  let expired = 0;
  for (const c of candidates) {
    try {
      expired += await prisma.$transaction(async (tx) => {
        await lockCustomer(tx, c.userId);
        const state = cashbackState(await loadEntries(tx, c.userId, c.currency), now);
        let n = 0;
        for (const lot of expiredLots(state, now)) {
          const key = `cashback:expire:${lot.id}`;
          if (await exists(tx, key)) continue;
          await tx.cashbackEntry.create({
            data: { userId: c.userId, currency: c.currency, kind: "EXPIRE", amount: -lot.remaining, lotId: lot.id, idempotencyKey: key },
          });
          await postCashbackLedger(tx, { type: "CASHBACK_EXPIRED", credit: -lot.remaining, currency: c.currency, key, description: "Cashback expired" });
          n++;
        }
        return n;
      });
    } catch (e) {
      logger.warn("Cashback expiry failed", { error: e instanceof Error ? e.message : "unknown" });
    }
  }
  return { cashbackExpired: expired };
}

/* ------------------------------------------------------------------ */
/* Admin adjustment                                                    */
/* ------------------------------------------------------------------ */

export async function adjustCashback(p: { adminId: string; userId: string; currency: string; amount: number; note: string; now?: Date }) {
  const now = p.now ?? new Date();
  const currency = normalizeCurrency(p.currency);
  const note = p.note.trim().slice(0, 300);
  if (!note) throw new CashbackError("Give a reason for the change.", 400);
  if (!Number.isSafeInteger(p.amount) || p.amount === 0 || Math.abs(p.amount) > 100_000_00) throw new CashbackError("Enter an amount (at most 100,000).", 400);
  const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { role: true } });
  if (!user || user.role !== "CUSTOMER") throw new CashbackError("Cashback is only for customer accounts.", 400);
  const { expiryDays } = await cashbackSettings();

  return prisma.$transaction(async (tx) => {
    await lockCustomer(tx, p.userId);
    const state = cashbackState(await loadEntries(tx, p.userId, currency), now);
    if (p.amount < 0 && -p.amount > state.available) throw new CashbackError("You cannot remove more than the available balance.", 400);
    const key = `cashback:adjust:${randomUUID()}`;
    const entry = await tx.cashbackEntry.create({
      data: {
        userId: p.userId, currency, kind: "ADJUST", amount: p.amount, note, createdById: p.adminId, idempotencyKey: key,
        ...(p.amount > 0 ? { expiresAt: new Date(now.getTime() + expiryDays * DAY) } : {}),
      },
    });
    await postCashbackLedger(tx, { type: "CASHBACK_ADJUSTED", credit: p.amount, currency, key, description: `Admin: ${note}`, createdById: p.adminId });
    await writeAudit(tx, { actorId: p.adminId, action: "CASHBACK_ADJUSTED", entityType: "user", entityId: p.userId, details: { entryId: entry.id, amount: p.amount, currency, note } });
    return { id: entry.id, available: state.available + p.amount };
  });
}
