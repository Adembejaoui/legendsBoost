// Server-only module.
/**
 * Suggested split of the booster share when several boosters worked on an
 * order (Phase 7, decision 2026-11-16: suggested by progress, the admin
 * confirms or changes it on the allocation screen).
 *
 * Progress per booster, measured over the time each one held the order:
 *   - rank services: rank points gained (Riot rank snapshots; before the
 *     first snapshot the Riot baseline, else the rank declared on the order);
 *   - Win Boost: wins played in their sessions.
 * Lost progress counts as 0. No measurable progress -> no suggestion.
 */
import prisma from "@/lib/prisma";
import { normalizeRank, rankToScore } from "@/lib/services/games/league-of-legends/progression.service";

export interface ProgressPoints {
  id: string;
  points: number;
}

/** Split `net` by points (floor), remainder to the booster with the most points. Null if nothing to split by. */
export function suggestSplit(net: number, entries: ProgressPoints[]): { id: string; amount: number }[] | null {
  const clean = entries.map((e) => ({ id: e.id, points: Math.max(0, e.points) }));
  const total = clean.reduce((a, e) => a + e.points, 0);
  if (net <= 0 || total <= 0) return null;
  const out = clean.map((e) => ({ id: e.id, amount: Math.floor((net * e.points) / total) }));
  const rest = net - out.reduce((a, e) => a + e.amount, 0);
  const top = clean.reduce((best, e, i) => (e.points > clean[best].points ? i : best), 0);
  out[top].amount += rest;
  return out;
}

type Win = { start: Date; end: Date | null; id: string };

function scoreOf(r: { tier: string | null; division: string | null; lp: number | null } | null): number | null {
  if (!r?.tier) return null;
  const n = normalizeRank(r.tier, r.division, r.lp ?? 0);
  return n ? rankToScore(n) : null;
}

export async function progressByAssignment(
  orderId: string,
  assignments: { id: string; startedAt: Date | null; endedAt: Date | null }[],
  now = new Date()
): Promise<{ basis: "rank" | "wins"; entries: ProgressPoints[] } | null> {
  const windows: Win[] = assignments.filter((a) => a.startedAt).map((a) => ({ id: a.id, start: a.startedAt!, end: a.endedAt }));
  if (windows.length === 0) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { serviceSlug: true, configuration: true, completedAt: true, riotAccount: { select: { baselineTier: true, baselineDivision: true, baselineLp: true } } },
  });
  if (!order) return null;
  const endOf = (w: Win) => w.end ?? order.completedAt ?? now;

  if (order.serviceSlug === "win-boost") {
    const wins = await prisma.orderMatch.findMany({ where: { orderId, win: true, playedBy: "BOOSTER" }, select: { gameStartAt: true } });
    const entries = windows.map((w) => ({
      id: w.id,
      points: wins.filter((m) => m.gameStartAt >= w.start && m.gameStartAt < endOf(w)).length,
    }));
    return { basis: "wins", entries };
  }

  const snapshots = await prisma.orderRankSnapshot.findMany({ where: { orderId }, orderBy: { takenAt: "asc" } });
  if (snapshots.length === 0) return null;
  const cfg = (order.configuration ?? {}) as { currentRank?: { tierId?: string; divisionId?: string | null } };
  const declared = cfg.currentRank?.tierId ? { tier: cfg.currentRank.tierId, division: cfg.currentRank.divisionId ?? null, lp: 0 } : null;
  const ra = order.riotAccount;
  const start = ra?.baselineTier ? { tier: ra.baselineTier, division: ra.baselineDivision, lp: ra.baselineLp } : declared;
  const rankAt = (t: Date) => {
    let found: { tier: string; division: string | null; lp: number } | null = null;
    for (const s of snapshots) if (s.takenAt <= t) found = s;
    return scoreOf(found ?? start);
  };
  const entries = windows.map((w) => {
    const a = rankAt(w.start);
    const b = rankAt(endOf(w));
    return { id: w.id, points: a === null || b === null ? 0 : b - a };
  });
  return { basis: "rank", entries };
}
