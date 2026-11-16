import type { RiotClient } from "./riot-client";
import { RiotApiError, RiotNotFoundError } from "./riot-client";
import { resolveRiotRouting } from "./routing";
import { accountRegionSchema, activeGameSchema, championMasteriesSchema, matchIdsSchema, summonerSchema } from "./riot.schemas";
import { fetchMatch } from "./match-history.service";
import type { RiotLeagueEntryDto, RiotPlatform } from "./riot.types";

/**
 * Riot profile snapshot stored on OrderRiotAccount.profile (display only).
 *
 * Every part is optional: one endpoint failing (rate limit, outage, an
 * endpoint the key is not allowed to call) never fails the order sync. A
 * failed part keeps the previous snapshot's value when one exists.
 * Contains no PUUIDs (other players' identities are dropped).
 */
export interface RiotProfileSnapshot {
  summonerLevel: number | null;
  profileIconId: number | null;
  activeRegion: string | null;
  ranked: { queue: string; tier: string | null; division: string | null; lp: number; wins: number; losses: number }[] | null;
  mastery: { championId: number; level: number; points: number; lastPlayedAt: string | null }[] | null;
  liveGame: { inGame: boolean; championId: number | null; queueId: number | null; gameMode: string | null; startedAt: string | null } | null;
  /** Newest Match-V5 id of the account (any queue): the "new game?" marker. */
  latestMatchId: string | null;
  /** The account's most recent games (any queue), newest first. */
  recentMatches: RecentMatch[] | null;
}

export interface RecentMatch {
  matchId: string;
  championId: number;
  championName: string;
  win: boolean;
  remake: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  durationSec: number;
  queueId: number;
  endedAt: string | null;
}

export const RECENT_MATCH_COUNT = 2;
export const TOP_CHAMPION_COUNT = 3;

/** Newest match ids (any queue). One cheap call: used to detect a new game. */
export async function fetchLatestMatchIds(
  client: RiotClient,
  platform: RiotPlatform,
  puuid: string,
  count: number,
  ctx: Ctx = {}
): Promise<string[]> {
  const { matchHost } = resolveRiotRouting(platform);
  return client.get(matchHost, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`, {
    schema: matchIdsSchema,
    query: { start: 0, count },
    ...ctx,
  });
}

type Ctx = { correlationId?: string; orderId?: string };

async function optional<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof RiotApiError) return { ok: false };
    throw error;
  }
}

export async function fetchRiotProfile(
  client: RiotClient,
  platform: RiotPlatform,
  puuid: string,
  leagueEntries: RiotLeagueEntryDto[] | null,
  previous: RiotProfileSnapshot | null,
  ctx: Ctx = {}
): Promise<RiotProfileSnapshot> {
  const { platformHost, accountHost } = resolveRiotRouting(platform);
  const p = encodeURIComponent(puuid);

  const [summoner, region, mastery, live] = await Promise.all([
    optional(() => client.get(platformHost, `/lol/summoner/v4/summoners/by-puuid/${p}`, { schema: summonerSchema, cacheTtlMs: 60_000, ...ctx })),
    optional(() => client.get(accountHost, `/riot/account/v1/region/by-game/lol/by-puuid/${p}`, { schema: accountRegionSchema, cacheTtlMs: 10 * 60_000, ...ctx })),
    optional(() =>
      client.get(platformHost, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${p}/top`, {
        schema: championMasteriesSchema,
        query: { count: TOP_CHAMPION_COUNT },
        cacheTtlMs: 5 * 60_000,
        ...ctx,
      })
    ),
    // 404 = not in a game: an answer, not a failure.
    (async () => {
      try {
        const g = await client.get(platformHost, `/lol/spectator/v5/active-games/by-summoner/${p}`, {
          schema: activeGameSchema,
          maxRetries: 0,
          ...ctx,
        });
        return { ok: true as const, value: g };
      } catch (error) {
        if (error instanceof RiotNotFoundError) return { ok: true as const, value: null };
        if (error instanceof RiotApiError) return { ok: false as const };
        throw error;
      }
    })(),
  ]);

  // Last games (any queue). Details are cached by the client (immutable).
  const ids = await optional(() => fetchLatestMatchIds(client, platform, puuid, RECENT_MATCH_COUNT, ctx));
  let recentMatches: RecentMatch[] | null = previous?.recentMatches ?? null;
  if (ids.ok) {
    const details = await Promise.all(ids.value.map((id) => optional(() => fetchMatch(client, platform, id, ctx))));
    if (details.every((d) => d.ok)) {
      recentMatches = details.flatMap((d) => {
        if (!d.ok) return [];
        const m = d.value;
        const me = m.info.participants.find((x) => x.puuid === puuid);
        if (!me) return [];
        return [{
          matchId: m.metadata.matchId,
          championId: me.championId,
          championName: me.championName,
          win: me.win,
          remake: !!me.gameEndedInEarlySurrender || m.info.gameDuration < 240,
          kills: me.kills,
          deaths: me.deaths,
          assists: me.assists,
          cs: me.totalMinionsKilled + me.neutralMinionsKilled,
          durationSec: m.info.gameDuration,
          queueId: m.info.queueId,
          endedAt: m.info.gameEndTimestamp ? new Date(m.info.gameEndTimestamp).toISOString() : null,
        }];
      });
    }
  }

  return {
    // Only advance the marker when the matches above are complete, so a
    // partial failure is retried on the next check.
    latestMatchId: ids.ok && recentMatches && (ids.value.length === 0 || recentMatches[0]?.matchId === ids.value[0]) ? ids.value[0] ?? null : previous?.latestMatchId ?? null,
    recentMatches,
    summonerLevel: summoner.ok ? summoner.value.summonerLevel ?? null : previous?.summonerLevel ?? null,
    profileIconId: summoner.ok ? summoner.value.profileIconId ?? null : previous?.profileIconId ?? null,
    activeRegion: region.ok ? region.value.region.toUpperCase() : previous?.activeRegion ?? null,
    ranked: leagueEntries
      ? leagueEntries.map((e) => ({
          queue: e.queueType,
          tier: e.tier ?? null,
          division: e.rank ?? null,
          lp: e.leaguePoints,
          wins: e.wins,
          losses: e.losses,
        }))
      : previous?.ranked ?? null,
    mastery: mastery.ok
      ? mastery.value.map((m) => ({
          championId: m.championId,
          level: m.championLevel,
          points: m.championPoints,
          lastPlayedAt: m.lastPlayTime ? new Date(m.lastPlayTime).toISOString() : null,
        }))
      : previous?.mastery ?? null,
    liveGame: live.ok
      ? live.value
        ? {
            inGame: true,
            championId: live.value.participants.find((x) => x.puuid === puuid)?.championId ?? null,
            queueId: live.value.gameQueueConfigId ?? null,
            gameMode: live.value.gameMode ?? null,
            startedAt: live.value.gameStartTime ? new Date(live.value.gameStartTime).toISOString() : null,
          }
        : { inGame: false, championId: null, queueId: null, gameMode: null, startedAt: null }
      : null,
  };
}

/** Parse a stored snapshot defensively (it is JSON from the database). */
export function readRiotProfile(value: unknown): RiotProfileSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Partial<RiotProfileSnapshot>;
  return {
    summonerLevel: typeof v.summonerLevel === "number" ? v.summonerLevel : null,
    profileIconId: typeof v.profileIconId === "number" ? v.profileIconId : null,
    activeRegion: typeof v.activeRegion === "string" ? v.activeRegion : null,
    ranked: Array.isArray(v.ranked) ? v.ranked : null,
    mastery: Array.isArray(v.mastery) ? v.mastery : null,
    liveGame: v.liveGame && typeof v.liveGame === "object" ? v.liveGame : null,
    latestMatchId: typeof v.latestMatchId === "string" ? v.latestMatchId : null,
    recentMatches: Array.isArray(v.recentMatches) ? v.recentMatches : null,
  };
}
