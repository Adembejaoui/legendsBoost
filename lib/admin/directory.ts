// Server-only module.
/**
 * Admin read models (Phase 9): user list, booster directory, live orders
 * board. Read-only; actions stay on the existing pages and routes.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/assignments/types";
import { STRIKE_WINDOW_DAYS } from "@/lib/boosters/discipline";

export async function listUsers(opts: { q?: string; role?: string; take?: number } = {}) {
  const q = opts.q?.trim();
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { id: q }] } : {}),
    ...(opts.role && ["ADMIN", "BOOSTER", "CUSTOMER"].includes(opts.role) ? { role: opts.role as "ADMIN" | "BOOSTER" | "CUSTOMER" } : {}),
  };
  return prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      deletedAt: true,
      boosterProfile: { select: { verificationStatus: true } },
      _count: { select: { orders: true } },
    },
  });
}

export async function boosterDirectory(opts: { status?: string } = {}) {
  const since = new Date(Date.now() - STRIKE_WINDOW_DAYS * 86_400_000);
  const profiles = await prisma.boosterProfile.findMany({
    where: { ...(opts.status ? { verificationStatus: opts.status as never } : {}), user: { deletedAt: null } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      userId: true,
      displayName: true,
      verificationStatus: true,
      trialOrdersRemaining: true,
      kycStatus: true,
      maxConcurrentOrders: true,
      user: { select: { name: true, email: true } },
      _count: { select: { permissions: true } },
    },
  });
  const ids = profiles.map((p) => p.userId);
  const [completed, active, ratings, strikes, fines] = await Promise.all([
    prisma.orderBoosterAssignment.groupBy({ by: ["boosterId"], where: { boosterId: { in: ids }, status: "COMPLETED" }, _count: { _all: true } }),
    prisma.orderBoosterAssignment.groupBy({ by: ["boosterId"], where: { boosterId: { in: ids }, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, _count: { _all: true } }),
    prisma.orderReview.groupBy({ by: ["boosterId"], where: { boosterId: { in: ids }, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.boosterStrike.groupBy({ by: ["boosterId"], where: { boosterId: { in: ids }, removedAt: null, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.boosterFine.groupBy({ by: ["boosterId"], where: { boosterId: { in: ids }, status: { in: ["ISSUED", "APPEALED", "UPHELD"] }, deductedPayoutId: null }, _sum: { amount: true } }),
  ]);
  const by = <T extends { boosterId: string }>(rows: T[]) => new Map(rows.map((r) => [r.boosterId, r]));
  const [c, a, r, s, f] = [by(completed), by(active), by(ratings), by(strikes), by(fines)];
  return profiles.map((p) => ({
    id: p.userId,
    name: p.user.name,
    email: p.user.email,
    displayName: p.displayName,
    status: p.verificationStatus,
    trialOrdersRemaining: p.trialOrdersRemaining,
    kycStatus: p.kycStatus,
    games: p._count.permissions,
    completed: c.get(p.userId)?._count._all ?? 0,
    active: a.get(p.userId)?._count._all ?? 0,
    limit: p.maxConcurrentOrders,
    rating: r.get(p.userId)?._avg.rating ?? null,
    reviews: r.get(p.userId)?._count._all ?? 0,
    strikes30d: s.get(p.userId)?._count._all ?? 0,
    finesDue: f.get(p.userId)?._sum.amount ?? 0,
  }));
}

export type BoardTone = "ok" | "warn" | "alert" | "idle";

/** Active orders with how long they have been waiting in their state. */
export async function liveOrdersBoard(now = new Date()) {
  const orders = await prisma.order.findMany({
    where: { status: { in: ["PENDING", "CLAIMED", "IN_PROGRESS", "PAUSED"] }, paymentVerifiedAt: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: {
      id: true,
      status: true,
      gameSlug: true,
      serviceSlug: true,
      paymentVerifiedAt: true,
      claimedAt: true,
      isPriority: true,
      updatedAt: true,
      user: { select: { name: true } },
      _count: { select: { bids: { where: { status: "ACTIVE" } } } },
      assignments: {
        where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
        select: { startedAt: true, assignedAt: true, inactivityWarnedAt: true, startWarnedAt: true, booster: { select: { name: true } } },
        take: 1,
      },
    },
  });
  const minutes = (d: Date | null | undefined) => (d ? Math.floor((now.getTime() - d.getTime()) / 60_000) : 0);
  return orders.map((o) => {
    const a = o.assignments[0];
    let since: Date | null = null;
    let tone: BoardTone = "ok";
    let note = "";
    if (o.status === "PENDING") {
      since = o.paymentVerifiedAt;
      const m = minutes(since);
      tone = m > 120 ? "alert" : m > 30 ? "warn" : "ok";
      note = `${o._count.bids} bid${o._count.bids === 1 ? "" : "s"}`;
    } else if (o.status === "CLAIMED") {
      since = o.claimedAt ?? a?.assignedAt ?? null;
      const m = minutes(since);
      tone = a?.startWarnedAt || m > 60 ? "alert" : m > 30 ? "warn" : "ok";
      note = "not started";
    } else if (o.status === "IN_PROGRESS") {
      since = a?.startedAt ?? null;
      tone = a?.inactivityWarnedAt ? "alert" : "ok";
      note = a?.inactivityWarnedAt ? "inactive" : "in progress";
    } else {
      since = o.updatedAt;
      tone = "idle";
      note = "paused by the customer";
    }
    return {
      id: o.id,
      status: o.status,
      gameSlug: o.gameSlug,
      serviceSlug: o.serviceSlug,
      customer: o.user.name,
      booster: a?.booster.name ?? null,
      isPriority: o.isPriority,
      minutes: minutes(since),
      tone,
      note,
    };
  });
}
