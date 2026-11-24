/**
 * Read models for the booster earnings page and the admin finance
 * dashboard. All figures are derived from the ledger and the earning /
 * payout / payment / refund / dispute records; nothing is a stored balance.
 */
import prisma from "@/lib/prisma";
import { countLabel, orderGameCount } from "@/lib/orders/game-count";
import { getGame } from "@/lib/catalog/games";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { formatRankLabel } from "@/lib/catalog/rank-systems";
import { orderRankSystemId } from "@/lib/orders/progress-updates.service";

const EARNING_STATE: Record<string, string> = {
  PENDING: "waiting for release",
  ON_HOLD: "on hold",
  PENDING_REVIEW: "under review",
  AVAILABLE: "completed",
  IN_PAYOUT: "in a payout",
  PAID: "paid out",
  REVERSED: "refunded",
};

/**
 * Why the booster got this money, for the Payments page (client PDF
 * 2026-11-23): "LoL Rank Boost (Silver IV → Gold IV) · completed", or
 * "Tip from the customer".
 */
export function earningReason(e: {
  status: string;
  allocationNote: string | null;
  order: { gameSlug: string; serviceSlug: string; configuration: unknown };
}): string {
  const state = EARNING_STATE[e.status] ?? e.status.toLowerCase();
  if (e.allocationNote === "Tip from the customer") return `Tip from the customer · ${state}`;
  const game = getGame(e.order.gameSlug);
  const offer = getGameServiceOffer(e.order.gameSlug, e.order.serviceSlug);
  const service = `${game?.shortName ?? e.order.gameSlug} ${offer?.title ?? e.order.serviceSlug}`;
  const cfg = (e.order.configuration ?? {}) as Record<string, unknown>;
  const system = orderRankSystemId(e.order.gameSlug, e.order.serviceSlug);
  const rank = (v: unknown) =>
    system && v && typeof v === "object" && typeof (v as { tierId?: unknown }).tierId === "string"
      ? formatRankLabel(system, v as { tierId: string; divisionId: string | null })
      : null;
  const from = rank(cfg.currentRank);
  const to = rank(cfg.targetRank);
  // "3 net wins", "5 placement games" (client PDFs 2026-11-24).
  const games = orderGameCount(e.order.gameSlug, e.order.serviceSlug, cfg);
  const units = games ? countLabel(games.total, games.unit) : null;
  const detail = from && to ? `${from} → ${to}` : units;
  return `${service}${detail ? ` (${detail})` : ""} · ${state}`;
}

type CurrencyMap = Record<string, number>;
const add = (m: CurrencyMap, c: string, v: number) => {
  m[c] = (m[c] ?? 0) + v;
};

/**
 * Fines the next payout will take off (same rule as finesDueForPayout:
 * issued or upheld, not yet deducted). Fines under appeal are not counted.
 */
async function unpaidFines(boosterId: string): Promise<CurrencyMap> {
  const rows = await prisma.boosterFine.groupBy({
    by: ["currency"],
    where: { boosterId, status: { in: ["ISSUED", "UPHELD"] }, deductedPayoutId: null },
    _sum: { amount: true },
  });
  const m: CurrencyMap = {};
  for (const r of rows) if (r._sum.amount) m[r.currency] = r._sum.amount;
  return m;
}

/** Assignment statuses in which the booster holds an order (claimed until completed). */
const HELD = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED", "SUBMITTED"] as const;

/**
 * Booster dashboard cards (client PDFs 2026-11-22):
 *  - Available: can be cashed out now (AVAILABLE earnings minus unpaid
 *    fines, i.e. what the next payout really pays; finesDue lists them);
 *  - Frozen: the payout of every order the booster holds, from the claim
 *    until an admin marks it Completed, plus completed earnings an admin
 *    still has to release (PENDING) or that a dispute froze (ON_HOLD).
 *    A booster who leaves an order loses its payout from Frozen;
 *  - waitingForReview: orders sent with screenshots, waiting for an admin.
 * Net of reversals, per currency. The ledger only moves at completion.
 */
export async function boosterBalances(boosterId: string) {
  const [rows, held, finesDue] = await Promise.all([
    prisma.boosterEarning.groupBy({
      by: ["status", "currency"],
      where: { boosterId, status: { in: ["AVAILABLE", "ON_HOLD", "PENDING"] } },
      _sum: { grossAmount: true, reversedAmount: true },
    }),
    prisma.orderBoosterAssignment.findMany({
      where: { boosterId, status: { in: [...HELD] } },
      select: {
        status: true,
        payoutAmount: true,
        order: { select: { currency: true, boosterPayoutAmount: true, pricingSnapshot: { select: { boosterShareAmount: true, currency: true } } } },
      },
    }),
    unpaidFines(boosterId),
  ]);
  const available: CurrencyMap = {};
  const frozen: CurrencyMap = {};
  for (const r of rows) {
    const net = (r._sum.grossAmount ?? 0) - (r._sum.reversedAmount ?? 0);
    add(r.status === "AVAILABLE" ? available : frozen, r.currency, net);
  }
  for (const [cur, amount] of Object.entries(finesDue)) add(available, cur, -amount);
  for (const a of held) {
    // Same amount the booster sees on the order page.
    const amount = a.payoutAmount ?? a.order.boosterPayoutAmount ?? a.order.pricingSnapshot?.boosterShareAmount ?? 0;
    add(frozen, a.order.pricingSnapshot?.currency ?? a.order.currency ?? "EUR", amount);
  }
  const waitingForReview = held.filter((a) => a.status === "SUBMITTED").length;
  return { available, frozen, finesDue, waitingForReview, activeOrders: held.length - waitingForReview };
}

export async function boosterFinance(boosterId: string) {
  const [earnings, payouts, payable, finesDue, balances] = await Promise.all([
    prisma.boosterEarning.findMany({
      where: { boosterId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { order: { select: { id: true, gameSlug: true, serviceSlug: true, status: true, completedAt: true, configuration: true } } },
    }),
    prisma.boosterPayout.findMany({ where: { boosterId }, orderBy: { requestedAt: "desc" }, take: 50 }),
    prisma.financialTransaction.groupBy({ by: ["currency"], where: { account: "BOOSTER_PAYABLE", boosterId }, _sum: { amount: true } }),
    unpaidFines(boosterId),
    boosterBalances(boosterId),
  ]);

  const pending: CurrencyMap = {};
  const onHold: CurrencyMap = {};
  const available: CurrencyMap = {};
  const inPayout: CurrencyMap = {};
  const paid: CurrencyMap = {};
  for (const e of earnings) {
    const net = e.grossAmount - e.reversedAmount;
    if (e.status === "PENDING") add(pending, e.currency, net);
    else if (e.status === "ON_HOLD") add(onHold, e.currency, net);
    else if (e.status === "AVAILABLE") add(available, e.currency, net);
    else if (e.status === "IN_PAYOUT") add(inPayout, e.currency, net);
    else if (e.status === "PAID") add(paid, e.currency, net);
  }
  const ledgerBalance: CurrencyMap = {};
  for (const r of payable) ledgerBalance[r.currency] = r._sum.amount ?? 0;

  return {
    // available stays the earnings total; finesDue is shown and subtracted by the page.
    // frozen = claimed orders + earnings waiting for release, per currency (client PDF 2026-11-23).
    totals: { pending, onHold, available, inPayout, paid, ledgerBalance, finesDue, frozen: balances.frozen },
    earnings: earnings
      .filter((e) => e.status !== "SPLIT")
      .map((e) => ({
        id: e.id,
        orderId: e.orderId,
        orderRef: e.orderId.slice(-8).toUpperCase(),
        service: `${e.order.gameSlug} / ${e.order.serviceSlug}`,
        reason: earningReason(e),
        orderStatus: e.order.status,
        completedAt: e.order.completedAt?.toISOString() ?? null,
        status: e.status,
        currency: e.currency,
        grossAmount: e.grossAmount,
        reversedAmount: e.reversedAmount,
        netAmount: e.grossAmount - e.reversedAmount,
        boosterShareBps: e.boosterShareBps,
        payoutId: e.payoutId,
        createdAt: e.createdAt.toISOString(),
      })),
    payouts: payouts.map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      externalReference: p.externalReference,
      rejectionReason: p.rejectionReason,
      failureReason: p.failureReason,
      requestedAt: p.requestedAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  };
}

export async function adminFinanceSummary() {
  const [ledger, byType, paymentsByStatus, earningsByStatus, disputesByStatus, refundsByStatus] = await Promise.all([
    prisma.financialTransaction.groupBy({ by: ["account", "currency"], _sum: { amount: true } }),
    prisma.financialTransaction.groupBy({ by: ["type", "currency"], _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.boosterEarning.groupBy({ by: ["status", "currency"], _sum: { grossAmount: true, reversedAmount: true }, _count: { _all: true } }),
    prisma.dispute.groupBy({ by: ["status", "currency"], _sum: { amount: true }, _count: { _all: true } }),
    prisma.refund.groupBy({ by: ["status", "currency"], _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const account = (name: string): CurrencyMap => {
    const m: CurrencyMap = {};
    for (const r of ledger) if (r.account === name) m[r.currency] = r._sum.amount ?? 0;
    return m;
  };
  const type = (name: string): CurrencyMap => {
    const m: CurrencyMap = {};
    for (const r of byType) if (r.type === name) m[r.currency] = r._sum.amount ?? 0;
    return m;
  };
  const earnings = (status: string): CurrencyMap => {
    const m: CurrencyMap = {};
    for (const r of earningsByStatus) if (r.status === status) add(m, r.currency, (r._sum.grossAmount ?? 0) - (r._sum.reversedAmount ?? 0));
    return m;
  };

  return {
    customerPayments: type("CUSTOMER_PAYMENT"),
    refunds: type("REFUND"),
    netCustomerFunds: account("CUSTOMER_PAYMENTS"),
    platformCommission: account("PLATFORM_REVENUE"),
    stripeFees: account("STRIPE_FEES"),
    unallocatedBoosterShare: account("BOOSTER_POOL"),
    outstandingBoosterLiabilities: account("BOOSTER_PAYABLE"),
    boosterPayouts: account("BOOSTER_PAYOUTS"),
    disputeLosses: type("DISPUTE_LOSS"),
    earnings: {
      reserved: earnings("RESERVED"),
      needsReview: earnings("PENDING_REVIEW"),
      pending: earnings("PENDING"),
      onHold: earnings("ON_HOLD"),
      available: earnings("AVAILABLE"),
      inPayout: earnings("IN_PAYOUT"),
      paid: earnings("PAID"),
    },
    payments: Object.fromEntries(paymentsByStatus.map((p) => [p.status, p._count._all])),
    disputes: disputesByStatus.map((d) => ({ status: d.status, currency: d.currency, count: d._count._all, amount: d._sum.amount ?? 0 })),
    refundsByStatus: refundsByStatus.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all, amount: r._sum.amount ?? 0 })),
  };
}

/** Items an admin must act on. */
export async function adminFinanceWorkQueue() {
  const [paymentsToReview, openDisputes, earningsToReview, earningsToApprove, payoutRequests, failedEvents, failedOutbox, recentPayments, pendingRefunds] =
    await Promise.all([
      prisma.payment.findMany({ where: { reviewReason: { not: null } }, orderBy: { updatedAt: "desc" }, take: 50 }),
      prisma.dispute.findMany({ where: { status: "OPEN" }, orderBy: { openedAt: "desc" }, take: 50 }),
      prisma.boosterEarning.findMany({
        where: { status: "PENDING_REVIEW" },
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: {
          order: {
            select: {
              id: true,
              assignments: {
                where: { startedAt: { not: null } },
                select: { id: true, status: true, endReason: true, startedAt: true, endedAt: true, booster: { select: { id: true, name: true } } },
                orderBy: { assignedAt: "asc" },
              },
            },
          },
        },
      }),
      prisma.boosterEarning.findMany({
        where: { status: "PENDING" },
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: { booster: { select: { name: true } }, order: { select: { status: true } } },
      }),
      prisma.boosterPayout.findMany({
        where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } },
        orderBy: { requestedAt: "asc" },
        include: { booster: { select: { id: true, name: true, email: true } } },
      }),
      prisma.paymentEvent.findMany({ where: { status: "FAILED" }, orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, type: true, stripeEventId: true, attempts: true, lastError: true, receivedAt: true } }),
      prisma.outboxEvent.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, attempts: true, lastError: true, createdAt: true } }),
      prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.refund.findMany({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
  return { paymentsToReview, openDisputes, earningsToReview, earningsToApprove, payoutRequests, failedEvents, failedOutbox, recentPayments, pendingRefunds };
}

export async function listTransactions(filter: { orderId?: string; boosterId?: string; cursor?: string; take?: number }) {
  const take = Math.min(Math.max(filter.take ?? 100, 1), 200);
  const rows = await prisma.financialTransaction.findMany({
    where: { ...(filter.orderId ? { orderId: filter.orderId } : {}), ...(filter.boosterId ? { boosterId: filter.boosterId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
  return { transactions: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id : null };
}
