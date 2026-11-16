// Server-only module.
/**
 * Phase 5 tracker additions, called by the Riot sync:
 *   - rank snapshots and the LP change of a game (Riot gives no LP per
 *     match: the change between two snapshots is given to a game only when
 *     it is the single new ranked game of that queue between them);
 *   - admin alerts for games played during a pause or outside a booster
 *     session (decision 2026-11-15: admins only, no automatic penalty).
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { normalizeRank, rankToScore } from "./progression.service";
import { QUEUE, type PlayedBy } from "./match-history.service";

export interface NewGame {
  matchId: string;
  queueId: number;
  gameStartAt: Date;
  playedBy: PlayedBy;
}

type Rank = { tier: string; division: string | null; lp: number };

/**
 * Store a snapshot when the rank changed or new games were found, and give
 * the LP change to the game when exactly one new ranked game of this queue
 * started after the previous snapshot. Returns the LP change given, if any.
 */
export async function recordRankSnapshot(
  orderId: string,
  queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR",
  rank: Rank,
  now: Date,
  newGames: NewGame[]
): Promise<number | null> {
  const queueId = queue === "RANKED_FLEX_SR" ? QUEUE.RANKED_FLEX : QUEUE.RANKED_SOLO;
  const games = newGames.filter((g) => g.queueId === queueId);
  const prev = await prisma.orderRankSnapshot.findFirst({ where: { orderId, queue }, orderBy: { takenAt: "desc" } });
  const same = !!prev && prev.tier === rank.tier && (prev.division ?? null) === (rank.division ?? null) && prev.lp === rank.lp;
  if (same && games.length === 0) return null;

  await prisma.orderRankSnapshot.create({
    data: { orderId, queue, tier: rank.tier, division: rank.division ?? null, lp: rank.lp, takenAt: now },
  });

  if (!prev || games.length !== 1 || prev.takenAt > games[0].gameStartAt) return null;
  const before = normalizeRank(prev.tier, prev.division, prev.lp);
  const after = normalizeRank(rank.tier, rank.division, rank.lp);
  if (!before || !after) return null;
  const delta = rankToScore(after) - rankToScore(before);
  await prisma.orderMatch.updateMany({ where: { orderId, matchId: games[0].matchId }, data: { lpDelta: delta } });
  return delta;
}

/** Record and notify admins about games not played inside a booster session. Never throws. */
export async function alertGameAnomalies(orderId: string, games: NewGame[]) {
  const odd = games.filter((g) => g.playedBy !== "BOOSTER");
  if (odd.length === 0) return 0;
  try {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    for (const g of odd) {
      const dedupeKey = `game-anomaly:${orderId}:${g.matchId}`;
      // Skip already-alerted games without relying on a failing insert.
      if (await prisma.notification.findFirst({ where: { dedupeKey }, select: { id: true } })) continue;
      await prisma.orderEvent.create({
        data: {
          orderId,
          type: g.playedBy === "PAUSED" ? "GAME_DURING_PAUSE" : "GAME_OUTSIDE_SESSION",
          message: g.playedBy === "PAUSED" ? "A ranked game was played while the order was paused" : "A ranked game was played outside a booster session",
          metadata: { matchId: g.matchId, gameStartAt: g.gameStartAt.toISOString() },
        },
      });
      await Promise.all(
        admins.map((a) => createNotification(a.id, "GAME_ANOMALY", orderId, { playedBy: g.playedBy, matchId: g.matchId }, "system", { dedupeKey }))
      );
    }
  } catch (e) {
    logger.warn("Game anomaly alert failed", { orderId, error: e instanceof Error ? e.message : "unknown" });
  }
  return odd.length;
}
