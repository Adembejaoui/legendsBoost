/**
 * Read models for the booster earnings page and the admin finance
 * dashboard. All figures are derived from the ledger and the earning /
 * payout / payment / refund / dispute records; nothing is a stored balance.
 */
import prisma from "@/lib/prisma";

type CurrencyMap = Record<string, number>;
const add = (m: CurrencyMap, c: string, v: number) => {
  m[c] = (m[c] ?? 0) + v;
};

/**
 * Booster dashboard cards (decision 2026-11-17): what can be cashed out now
 * (AVAILABLE), what is frozen by a dispute / chargeback (ON_HOLD), and what
 * waits for an admin release (PENDING) plus the orders still waiting for the
 * customer's confirmation. Net of reversals, per currency.
 */
export async function boosterBalances(boosterId: string) {
  const [rows, awaitingConfirmation] = await Promise.all([
    prisma.boosterEarning.groupBy({
      by: ["status", "currency"],
      where: { boosterId, status: { in: ["AVAILABLE", "ON_HOLD", "PENDING"] } },
      _sum: { grossAmount: true, reversedAmount: true },
    }),
    prisma.orderBoosterAssignment.count({ where: { boosterId, status: "SUBMITTED" } }),
  ]);
  const available: CurrencyMap = {};
  const frozen: CurrencyMap = {};
  const pending: CurrencyMap = {};
  for (const r of rows) {
    const net = (r._sum.grossAmount ?? 0) - (r._sum.reversedAmount ?? 0);
    add(r.status === "AVAILABLE" ? available : r.status === "ON_HOLD" ? frozen : pending, r.currency, net);
  }
  return { available, frozen, pending, awaitingConfirmation };
}

export async function boosterFinance(boosterId: string) {
  const [earnings, payouts, payable] = await Promise.all([
    prisma.boosterEarning.findMany({
      where: { boosterId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { order: { select: { id: true, gameSlug: true, serviceSlug: true, status: true, completedAt: true } } },
    }),
    prisma.boosterPayout.findMany({ where: { boosterId }, orderBy: { requestedAt: "desc" }, take: 50 }),
    prisma.financialTransaction.groupBy({ by: ["currency"], where: { account: "BOOSTER_PAYABLE", boosterId }, _sum: { amount: true } }),
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
    totals: { pending, onHold, available, inPayout, paid, ledgerBalance },
    earnings: earnings
      .filter((e) => e.status !== "SPLIT")
      .map((e) => ({
        id: e.id,
        orderId: e.orderId,
        orderRef: e.orderId.slice(-8).toUpperCase(),
        service: `${e.order.gameSlug} / ${e.order.serviceSlug}`,
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
