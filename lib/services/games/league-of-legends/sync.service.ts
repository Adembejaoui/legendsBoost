import { alertGameAnomalies, recordRankSnapshot, type NewGame } from "./tracker-events";
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { signalOrder } from "@/lib/realtime/live";
import { getRiotCapabilities } from "./capabilities";
import {
  RiotApiError,
  RiotAuthError,
  RiotBadRequestError,
  RiotNotFoundError,
  RiotRateLimitedError,
  type RiotClient,
} from "./riot-client";
import { getRiotClient } from "./shared-client";
import { resolveAccountByRiotId } from "./account.service";
import { verifyAccountRegion } from "./region.service";
import { fetchLeagueEntries, pickQueueRank } from "./rank.service";
import { fetchRiotProfile, readRiotProfile } from "./profile.service";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  attributeMatch,
  boosterWindows,
  pauseWindows,
  scanWindows,
  fetchMatch,
  fetchMatchIds,
  getOrderQueueIds,
  QUEUE,
  toOrderMatchRecord,
} from "./match-history.service";
import { isRiotPlatform, RIOT_PLATFORM_LABELS, unsupportedPlatformReason } from "./routing";
import type { RiotPlatform } from "./riot.types";

/**
 * Riot data sync for ONE order.
 *
 * Integrity rules:
 *  1. Durable progress. A scan lists Match-V5 ids for the order's work
 *     windows and stores every unseen id in `pendingMatchIds`; the scan
 *     cursor `matchScanUntil` only advances after a COMPLETE scan. Details
 *     are then processed from the pending list (max per run), and each match
 *     is committed together with its removal from the list. Nothing is ever
 *     dropped because of a cap or a failure: it simply stays pending.
 *  2. Re-scans overlap the cursor (INCREMENTAL_OVERLAP_MS) so games that were
 *     still running, or not yet indexed by Riot, during the previous scan
 *     are found. Duplicates are impossible: ids are de-duplicated against
 *     stored matches and the pending list, and (orderId, matchId) is unique.
 *  3. One sync per order at a time (a short database lease).
 *  4. Every write is conditional on the account identity read at the start,
 *     so a concurrent Riot ID change can never receive the old account's data.
 *  5. The selected region must be confirmed by Summoner-V4 before anything is
 *     attributed; a wrong region is an error, never an empty "success".
 */

/** Re-scan this far before the cursor (long games, Riot indexing delay). */
export const INCREMENTAL_OVERLAP_MS = 2 * 60 * 60 * 1000;
/** Upper bound on Match-V5 detail calls per sync (rate-limit friendly). */
export const MAX_MATCH_DETAILS_PER_SYNC = 20;
/** A crashed sync releases its lease after this long. */
export const SYNC_LEASE_MS = 2 * 60 * 1000;

export type SyncOutcome =
  | { status: "synced"; newMatches: number; pendingMatches: number; complete: boolean; rankObserved: boolean }
  | { status: "unavailable"; reason: string }
  | { status: "needs_account"; reason: string }
  | {
      status: "account_error";
      code: "not_found" | "wrong_region";
      reason: string;
      suggestedPlatform?: RiotPlatform | null;
    }
  | { status: "busy"; reason: string }
  | {
      status: "error";
      reason: string;
      retryAfterSec?: number;
      newMatches?: number;
      pendingMatches?: number;
    };

class AccountChangedError extends Error {}
class AccountProblem extends Error {
  constructor(public readonly outcome: Extract<SyncOutcome, { status: "account_error" }>) {
    super(outcome.reason);
  }
}

function safeError(error: unknown): { reason: string; code: string; retryAfterSec?: number } {
  if (error instanceof RiotRateLimitedError) {
    return { reason: "Riot API is busy. Try again shortly.", code: "rate_limited", retryAfterSec: error.retryAfterSec };
  }
  if (error instanceof RiotAuthError) {
    // Operator problem (expired/invalid key); details are in the server log.
    return { reason: "Riot data is temporarily unavailable.", code: "riot_auth" };
  }
  if (error instanceof RiotApiError) return { reason: "Riot data is temporarily unavailable.", code: error.kind };
  if (error instanceof AccountChangedError) {
    return { reason: "The Riot account was changed during the sync. Sync again.", code: "account_changed" };
  }
  return { reason: "Riot data sync failed.", code: "internal" };
}

export async function syncOrderRiotData(
  orderId: string,
  opts: { client?: RiotClient; now?: Date } = {}
): Promise<SyncOutcome> {
  const caps = getRiotCapabilities();
  if (!caps.dataAccess) {
    return { status: "unavailable", reason: caps.reason ?? "Riot integration unavailable." };
  }
  if ((await getConfig("tracker_provider")) !== "riot") {
    return { status: "unavailable", reason: "Riot tracking is turned off (config tracker_provider)." };
  }
  const client = opts.client ?? getRiotClient();
  const now = opts.now ?? new Date();
  const ctx = { correlationId: randomUUID(), orderId };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      riotAccount: true,
      assignments: { select: { id: true, status: true, startedAt: true, endedAt: true } },
      sessions: { select: { startedAt: true, endedAt: true } },
      events: {
        where: { type: { in: ["ORDER_PAUSED", "ORDER_RESUMED"] } },
        select: { type: true, createdAt: true },
      },
    },
  });
  if (!order) return { status: "error", reason: "Order not found." };
  const account = order.riotAccount;
  if (!account || !account.platform) {
    return { status: "needs_account", reason: "Add the Riot ID and region first." };
  }
  const unsupported = unsupportedPlatformReason(account.platform);
  if (unsupported || !isRiotPlatform(account.platform)) {
    return { status: "needs_account", reason: unsupported ?? "Choose a supported Riot region." };
  }
  const platform = account.platform as RiotPlatform;

  // 3. Lease: one sync per order at a time.
  const leaseUntil = new Date(now.getTime() + SYNC_LEASE_MS);
  const lease = await prisma.orderRiotAccount.updateMany({
    where: { id: account.id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }] },
    data: { syncLeaseUntil: leaseUntil },
  });
  if (lease.count === 0) return { status: "busy", reason: "A sync for this order is already running." };

  const identity = { gameName: account.gameName, tagLine: account.tagLine, platform: account.platform };
  let newMatches = 0;
  let pending = [...account.pendingMatchIds];

  /** Resolve the Riot ID, confirm the region and persist (canonical) identity. */
  async function resolveIdentity(
    previousPuuid: string | null,
    known?: Awaited<ReturnType<typeof resolveAccountByRiotId>>
  ): Promise<string> {
    let dto = known;
    try {
      dto ??= await resolveAccountByRiotId(client, platform, identity.gameName, identity.tagLine, ctx);
    } catch (error) {
      if (error instanceof RiotNotFoundError) {
        throw new AccountProblem({
          status: "account_error",
          code: "not_found",
          reason: "No Riot account has this Riot ID. Check the game name and tagline.",
        });
      }
      throw error;
    }
    await ensureRegion(dto.puuid);
    const saved = await prisma.orderRiotAccount.updateMany({
      where: { id: account!.id, ...identity, puuid: previousPuuid },
      data: {
        puuid: dto.puuid,
        // Riot's canonical spelling; comparisons elsewhere are case-insensitive.
        ...(dto.gameName ? { gameName: dto.gameName } : {}),
        ...(dto.tagLine ? { tagLine: dto.tagLine } : {}),
        linkStatus: account!.linkStatus === "RSO_VERIFIED" ? "RSO_VERIFIED" : "RESOLVED",
        regionVerifiedAt: now,
      },
    });
    if (saved.count === 0) throw new AccountChangedError();
    if (dto.gameName) identity.gameName = dto.gameName;
    if (dto.tagLine) identity.tagLine = dto.tagLine;
    return dto.puuid;
  }

  async function ensureRegion(puuid: string) {
    const check = await verifyAccountRegion(client, platform, puuid, ctx);
    if (!check.ok) {
      const label = `${RIOT_PLATFORM_LABELS[platform]} (${platform})`;
      const hint = check.suggestedPlatform
        ? ` Riot reports it plays on ${RIOT_PLATFORM_LABELS[check.suggestedPlatform]} (${check.suggestedPlatform}).`
        : "";
      throw new AccountProblem({
        status: "account_error",
        code: "wrong_region",
        reason: `This Riot ID exists but has no League of Legends profile on ${label}. Choose the region the account plays on.${hint}`,
        suggestedPlatform: check.suggestedPlatform,
      });
    }
  }

  /** Persist pending ids (and optionally the scan cursor) for this exact account. */
  async function savePending(puuid: string, extra: { matchScanUntil?: Date } = {}) {
    const r = await prisma.orderRiotAccount.updateMany({
      where: { id: account!.id, ...identity, puuid },
      data: { pendingMatchIds: pending, ...extra },
    });
    if (r.count === 0) throw new AccountChangedError();
  }

  async function work(puuid: string): Promise<SyncOutcome> {
    const queueIds = getOrderQueueIds(order!.gameSlug, order!.serviceSlug, (order!.configuration ?? {}) as Record<string, unknown>);
    // Look for games over the whole time boosters held the order (pauses
    // included); label each as booster (session), customer or paused.
    const end = order!.completedAt ?? now;
    const windows = scanWindows(order!.assignments, end);
    const pauses = pauseWindows(order!.events, end);
    const booster = boosterWindows(order!.assignments, order!.sessions ?? [], order!.events, end);
    const newGames: NewGame[] = [];

    // 1a. Scan: discover ids, then advance the cursor only if the scan is complete.
    const stored = new Set(
      (await prisma.orderMatch.findMany({ where: { orderId }, select: { matchId: true } })).map((m) => m.matchId)
    );
    const scanFrom = account!.matchScanUntil ? account!.matchScanUntil.getTime() - INCREMENTAL_OVERLAP_MS : -Infinity;
    const scanTo = now.getTime();
    let truncated = false;
    const discovered: string[] = [];
    for (const w of windows) {
      const start = Math.max(w.start, scanFrom);
      const end = Math.min(w.end, scanTo);
      if (start >= end) continue;
      for (const queue of queueIds) {
        const page = await fetchMatchIds(
          client,
          platform,
          puuid,
          { startTime: Math.floor(start / 1000), endTime: Math.ceil(end / 1000), queue },
          ctx
        );
        truncated ||= page.truncated;
        // Riot lists newest first; keep the pending queue oldest first.
        for (const id of [...page.ids].reverse()) {
          if (!stored.has(id) && !pending.includes(id) && !discovered.includes(id)) discovered.push(id);
        }
      }
    }
    pending = [...pending, ...discovered];
    await savePending(puuid, truncated ? {} : { matchScanUntil: now });

    // 1b. Process pending details; commit each match with its removal from the queue.
    let stopError: unknown = null;
    for (const id of pending.slice(0, MAX_MATCH_DETAILS_PER_SYNC)) {
      let match;
      try {
        match = await fetchMatch(client, platform, id, ctx);
      } catch (error) {
        if (error instanceof RiotNotFoundError) {
          match = null; // Riot has no such match: nothing to attribute.
        } else {
          stopError = error; // keep it (and the rest) pending
          break;
        }
      }
      const attribution = match ? attributeMatch({ match, puuid, windows, queueIds, booster, pauses }) : null;
      const record =
        match && attribution?.attributed ? { orderId, ...toOrderMatchRecord(match, puuid), playedBy: attribution.playedBy } : null;
      const remaining = pending.filter((x) => x !== id);
      await prisma.$transaction(async (tx) => {
        const r = await tx.orderRiotAccount.updateMany({
          where: { id: account!.id, ...identity, puuid },
          data: { pendingMatchIds: remaining },
        });
        if (r.count === 0) throw new AccountChangedError();
        if (record) {
          const created = await tx.orderMatch.createMany({ data: [record], skipDuplicates: true });
          newMatches += created.count;
          if (created.count > 0) {
            newGames.push({ matchId: record.matchId, queueId: record.queueId, gameStartAt: record.gameStartAt, playedBy: record.playedBy });
          }
        }
      });
      pending = remaining;
      if (record) stored.add(record.matchId);
    }
    if (stopError) throw stopError;

    // 2. Rank.
    const rankQueue =
      queueIds.includes(QUEUE.RANKED_FLEX) && !queueIds.includes(QUEUE.RANKED_SOLO) ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5";
    // Ranked entries drive progress only on ranked services, but are always
    // shown in the profile; on other services a failure is tolerated.
    const entries: Awaited<ReturnType<typeof fetchLeagueEntries>> | null =
      queueIds.length > 0
        ? await fetchLeagueEntries(client, platform, puuid, ctx)
        : await fetchLeagueEntries(client, platform, puuid, ctx).catch((e) => {
            if (e instanceof RiotApiError) return null;
            throw e;
          });
    const rank = queueIds.length > 0 && entries ? pickQueueRank(entries, rankQueue) : null;

    // Profile snapshot (level, icon, all queues, mastery, live game). Optional parts.
    const profile = await fetchRiotProfile(client, platform, puuid, entries, readRiotProfile(account!.profile), ctx);

    // A Riot baseline is only trustworthy before any order game exists
    // (stored or still pending); otherwise the declared start is used.
    const captureBaseline = !account!.baselineAt && rank && windows.length > 0 && stored.size === 0 && pending.length === 0;

    const done = await prisma.orderRiotAccount.updateMany({
      where: { id: account!.id, ...identity, puuid },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
        lastSyncErrorCode: null,
        profile: profile as unknown as Prisma.InputJsonValue,
        profileSyncedAt: now,
        ...(rank ? { observedTier: rank.tier, observedDivision: rank.division, observedLp: rank.lp, observedAt: now } : {}),
        ...(captureBaseline
          ? { baselineTier: rank!.tier, baselineDivision: rank!.division, baselineLp: rank!.lp, baselineAt: now, baselineSource: "riot" }
          : {}),
      },
    });
    if (done.count === 0) throw new AccountChangedError();

    // Phase 5: LP change per game from rank snapshots; admin alerts for games
    // outside booster sessions. Best effort: the sync itself already succeeded.
    if (rank) {
      await recordRankSnapshot(orderId, rankQueue, rank, now, newGames).catch((e) =>
        logger.warn("Rank snapshot failed", { orderId, error: e instanceof Error ? e.message : "unknown" })
      );
    }
    await alertGameAnomalies(orderId, newGames);
    // Live: the order page shows new games / a rank change without a refresh.
    const rankChanged =
      !!rank && (rank.tier !== account!.observedTier || (rank.division ?? null) !== (account!.observedDivision ?? null) || rank.lp !== account!.observedLp);
    if (newMatches > 0 || rankChanged) await signalOrder(orderId, "riot");

    return { status: "synced", newMatches, pendingMatches: pending.length, complete: pending.length === 0 && !truncated, rankObserved: !!rank };
  }

  try {
    let puuid = account.puuid;
    if (!puuid) puuid = await resolveIdentity(null);
    else if (!account.regionVerifiedAt) {
      await ensureRegion(puuid);
      const r = await prisma.orderRiotAccount.updateMany({
        where: { id: account.id, ...identity, puuid },
        data: { regionVerifiedAt: now },
      });
      if (r.count === 0) throw new AccountChangedError();
    }

    try {
      return await work(puuid);
    } catch (error) {
      // PUUID recovery: a 400 on a by-puuid call may mean the stored PUUID is
      // not valid for this key. Re-resolve ONCE; keep the old PUUID unless the
      // lookup succeeds AND returns a different value; retry the work once.
      if (!(error instanceof RiotBadRequestError)) throw error;
      const fresh = await resolveAccountByRiotId(client, platform, identity.gameName, identity.tagLine, ctx).catch(() => null);
      if (!fresh || fresh.puuid === puuid) throw error;
      const recovered = await resolveIdentity(puuid, fresh);
      return await work(recovered);
    }
  } catch (error) {
    if (error instanceof AccountProblem) {
      await prisma.orderRiotAccount
        .updateMany({
          where: { id: account.id, gameName: identity.gameName, tagLine: identity.tagLine, platform: identity.platform },
          data: { lastSyncError: error.outcome.reason, lastSyncErrorCode: error.outcome.code },
        })
        .catch(() => {});
      return error.outcome;
    }
    const safe = safeError(error);
    await prisma.orderRiotAccount
      .updateMany({
        where: { id: account.id, gameName: identity.gameName, tagLine: identity.tagLine, platform: identity.platform },
        data: { lastSyncError: safe.reason, lastSyncErrorCode: safe.code },
      })
      .catch(() => {});
    return {
      status: "error",
      reason: safe.reason,
      ...(safe.retryAfterSec ? { retryAfterSec: safe.retryAfterSec } : {}),
      newMatches,
      pendingMatches: pending.length,
    };
  } finally {
    await prisma.orderRiotAccount
      .updateMany({ where: { id: account.id, syncLeaseUntil: leaseUntil }, data: { syncLeaseUntil: null } })
      .catch(() => {});
  }
}
