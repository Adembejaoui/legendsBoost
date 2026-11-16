/**
 * Immutable financial ledger (FinancialTransaction).
 *
 * Rules:
 *   - every posting carries a globally unique idempotencyKey, so retried
 *     webhooks / requests can never post twice;
 *   - rows are never updated or deleted (database trigger); corrections are
 *     new compensating postings;
 *   - amounts are signed integers in minor units; zero postings are skipped.
 * Account semantics: docs/FINANCIAL-LEDGER-DESIGN.md.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { assertAmount, normalizeCurrency } from "@/lib/money";

export type LedgerAccountName =
  | "CUSTOMER_PAYMENTS"
  | "PLATFORM_REVENUE"
  | "BOOSTER_POOL"
  | "BOOSTER_PAYABLE"
  | "BOOSTER_PAYOUTS"
  | "STRIPE_FEES"
  | "DISPUTE_LOSSES";

export type LedgerTransactionType =
  | "CUSTOMER_PAYMENT"
  | "PLATFORM_COMMISSION"
  | "BOOSTER_SHARE_RESERVED"
  | "BOOSTER_EARNING_ALLOCATED"
  | "REFUND"
  | "PLATFORM_COMMISSION_REVERSAL"
  | "BOOSTER_SHARE_REVERSAL"
  | "STRIPE_FEE"
  | "DISPUTE_LOSS"
  | "BOOSTER_PAYOUT"
  | "BOOSTER_BID_MARGIN"
  | "BOOSTER_FINE"
  | "BOOSTER_FINE_REVERSAL"
  | "TIP_PAYMENT"
  | "TIP_COMMISSION"
  | "TIP_BOOSTER_SHARE";

export interface Posting {
  type: LedgerTransactionType;
  account: LedgerAccountName;
  amount: number;
  currency: string;
  idempotencyKey: string;
  orderId?: string | null;
  boosterId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  disputeId?: string | null;
  payoutId?: string | null;
  earningId?: string | null;
  description?: string | null;
  createdById?: string | null;
}

/** Post entries inside the caller's transaction. Returns how many were new. */
export async function postLedger(tx: Prisma.TransactionClient, postings: Posting[]): Promise<number> {
  const rows = postings
    .filter((p) => p.amount !== 0)
    .map((p) => {
      assertAmount(p.amount, `ledger ${p.type}`);
      if (p.account === "BOOSTER_PAYABLE" && !p.boosterId) throw new Error("BOOSTER_PAYABLE postings need a boosterId");
      return {
        type: p.type,
        account: p.account,
        amount: p.amount,
        currency: normalizeCurrency(p.currency),
        idempotencyKey: p.idempotencyKey,
        orderId: p.orderId ?? null,
        boosterId: p.boosterId ?? null,
        paymentId: p.paymentId ?? null,
        refundId: p.refundId ?? null,
        disputeId: p.disputeId ?? null,
        payoutId: p.payoutId ?? null,
        earningId: p.earningId ?? null,
        description: p.description?.slice(0, 500) ?? null,
        createdById: p.createdById ?? null,
      };
    });
  if (rows.length === 0) return 0;
  const result = await tx.financialTransaction.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Sum of an account (optionally per booster / order / currency). */
export async function accountBalance(
  account: LedgerAccountName,
  filter: { boosterId?: string; orderId?: string; currency?: string } = {},
  db: Db = prisma
): Promise<number> {
  const r = await db.financialTransaction.aggregate({
    _sum: { amount: true },
    where: { account, ...filter },
  });
  return r._sum.amount ?? 0;
}

/** Balances of every account per currency (admin overview). */
export async function balancesByAccount(db: Db = prisma) {
  const rows = await db.financialTransaction.groupBy({
    by: ["account", "currency"],
    _sum: { amount: true },
  });
  return rows.map((r) => ({ account: r.account, currency: r.currency, amount: r._sum.amount ?? 0 }));
}
