// Server-only module.
/**
 * Admin overview numbers (Phase 9). All money comes from the ledger or the
 * pricing snapshots, per currency; nothing is estimated.
 */
import prisma from "@/lib/prisma";

export type AnalyticsRange = 7 | 30;

function byCurrency(rows: { currency: string; _sum: { amount?: number | null; totalAmount?: number | null } }[], field: "amount" | "totalAmount") {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + (r._sum[field] ?? 0);
  return out;
}

export async function adminAnalytics(days: AnalyticsRange, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [paid, revenue, margin, payable, claimed, completed, cancelled, startMissed, inactivity, topBoosters] = await Promise.all([
    prisma.order.count({ where: { paymentVerifiedAt: { gte: since } } }),
    prisma.orderPricingSnapshot.groupBy({ by: ["currency"], where: { order: { paymentVerifiedAt: { gte: since } } }, _sum: { totalAmount: true } }),
    prisma.financialTransaction.groupBy({ by: ["currency"], where: { account: "PLATFORM_REVENUE", createdAt: { gte: since } }, _sum: { amount: true } }),
    // Owed to boosters right now (earned, not paid out yet), all time.
    prisma.financialTransaction.groupBy({ by: ["currency"], where: { account: "BOOSTER_PAYABLE" }, _sum: { amount: true } }),
    prisma.order.findMany({
      where: { claimedAt: { gte: since }, paymentVerifiedAt: { not: null } },
      select: { claimedAt: true, paymentVerifiedAt: true },
    }),
    prisma.order.count({ where: { status: "COMPLETED", completedAt: { gte: since } } }),
    prisma.order.count({ where: { status: "CANCELLED", updatedAt: { gte: since }, paymentVerifiedAt: { not: null } } }),
    prisma.orderEvent.count({ where: { type: "SLA_START_MISSED", createdAt: { gte: since } } }),
    prisma.orderEvent.count({ where: { type: "INACTIVITY_WARNING", createdAt: { gte: since } } }),
    prisma.orderBoosterAssignment.groupBy({
      by: ["boosterId"],
      where: { status: "COMPLETED", endedAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { boosterId: "desc" } },
      take: 5,
    }),
  ]);

  const waits = claimed
    .filter((o) => o.claimedAt && o.paymentVerifiedAt && o.claimedAt >= o.paymentVerifiedAt)
    .map((o) => (o.claimedAt!.getTime() - o.paymentVerifiedAt!.getTime()) / 60_000);
  const avgMinutesToClaim = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;

  const ids = topBoosters.map((b) => b.boosterId);
  const [users, ratings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, boosterProfile: { select: { displayName: true } } } }),
    prisma.orderReview.groupBy({ by: ["boosterId"], where: { boosterId: { in: ids }, hiddenAt: null }, _avg: { rating: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.boosterProfile?.displayName ?? u.name ?? "Booster"]));
  const ratingOf = new Map(ratings.map((r) => [r.boosterId, r._avg.rating]));

  return {
    days,
    paidOrders: paid,
    revenue: byCurrency(revenue, "totalAmount"),
    platformMargin: byCurrency(margin, "amount"),
    owedToBoosters: byCurrency(payable, "amount"),
    avgMinutesToClaim,
    completedOrders: completed,
    cancelledOrders: cancelled,
    startWarnings: startMissed,
    inactivityWarnings: inactivity,
    topBoosters: topBoosters.map((b) => ({
      id: b.boosterId,
      name: nameOf.get(b.boosterId) ?? "Booster",
      completed: b._count._all,
      rating: ratingOf.get(b.boosterId) ?? null,
    })),
  };
}
