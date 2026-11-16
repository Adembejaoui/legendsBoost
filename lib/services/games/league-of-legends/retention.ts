// Server-only module.
/**
 * Riot data retention (decision 2026-11-15: 15 days, config
 * match_retention_days). Once an order has been completed or cancelled for
 * that long, its match history and rank snapshots are deleted and the cached
 * Riot profile is cleared. The order, its Riot ID and all money records stay.
 */
import prisma from "@/lib/prisma";
import { getConfig } from "@/lib/config";
import { Prisma } from "@/app/generated/prisma/client";

export async function purgeOldTrackerData(now = new Date(), batch = 200) {
  const days = await getConfig("match_retention_days");
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { status: "COMPLETED", completedAt: { lt: cutoff } },
        // Cancelled orders have no end date of their own: last update.
        { status: "CANCELLED", updatedAt: { lt: cutoff } },
      ],
      AND: [{ OR: [{ matches: { some: {} } }, { rankSnapshots: { some: {} } }, { riotAccount: { profile: { not: Prisma.DbNull } } }] }],
    },
    select: { id: true },
    take: batch,
  });
  const ids = orders.map((o) => o.id);
  if (ids.length === 0) return { orders: 0, matches: 0, snapshots: 0, days };
  const [matches, snapshots] = await prisma.$transaction([
    prisma.orderMatch.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderRankSnapshot.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderRiotAccount.updateMany({ where: { orderId: { in: ids } }, data: { profile: Prisma.DbNull, profileSyncedAt: null, pendingMatchIds: [] } }),
  ]);
  return { orders: ids.length, matches: matches.count, snapshots: snapshots.count, days };
}
