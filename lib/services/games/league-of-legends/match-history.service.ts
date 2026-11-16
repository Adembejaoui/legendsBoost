/**
 * Order-specific match history.
 *
 * A match belongs to an order only when ALL of these hold:
 *  1. The order's Riot account (PUUID locked on the order) played in it.
 *  2. It was played entirely inside one of the order's work windows: from an
 *     assignment's start to its end (or now), minus the time the order was
 *     paused. Time while the order was PENDING / DRAFT / unassigned never
 *     counts, so games the customer plays themselves are not attributed.
 *  3. Its queue is one the ordered service is played in (e.g. Rank Boost ->
 *     Ranked Solo/Duo).
 *  4. It is not a remake.
 * Anything that cannot be verified is NOT shown as an order match.
 */
import type { RiotClient } from "./riot-client";
import { resolveRiotRouting } from "./routing";
import { MATCH_ID_PATTERN, matchIdsSchema, matchSchema } from "./riot.schemas";
import type { RiotMatchDto, RiotPlatform } from "./riot.types";

export const QUEUE = {
  RANKED_SOLO: 420,
  RANKED_FLEX: 440,
  ARENA: 1700,
} as const;

export const QUEUE_LABELS: Record<number, string> = {
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  1700: "Arena",
};

/**
 * Remakes. Riot ends a remade game with `gameEndedInEarlySurrender` on its
 * participants (the remake vote is the only "early surrender"; a normal
 * surrender is `gameEndedInSurrender`). Riot's reference text for that field
 * is unreliable, so a second, field-independent rule also applies: no real
 * Summoner's Rift / Arena game can finish in under 4 minutes, so anything
 * shorter is treated as a remake/aborted game and never counted.
 */
export const MIN_COUNTED_GAME_SEC = 240;

export function isRemake(match: RiotMatchDto): boolean {
  if (match.info.participants.some((p) => p.gameEndedInEarlySurrender === true)) return true;
  return match.info.gameDuration < MIN_COUNTED_GAME_SEC;
}

export interface WorkWindow {
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface WindowAssignment {
  id: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface WindowEvent {
  type: string;
  createdAt: Date;
  metadata?: unknown;
}

/** Queues a service is played in. Unknown services attribute nothing. */
export function getOrderQueueIds(
  gameSlug: string,
  serviceSlug: string,
  configuration: Record<string, unknown>
): number[] {
  if (gameSlug !== "league-of-legends") return [];
  switch (serviceSlug) {
    case "rank-boost":
      return [QUEUE.RANKED_SOLO];
    case "win-boost":
      return configuration.gameMode === "ranked-flex" ? [QUEUE.RANKED_FLEX] : [QUEUE.RANKED_SOLO];
    case "placement-boost":
      return [QUEUE.RANKED_SOLO, QUEUE.RANKED_FLEX];
    case "arena-boost":
      return [QUEUE.ARENA];
    default:
      return [];
  }
}

function subtract(window: WorkWindow, gaps: WorkWindow[]): WorkWindow[] {
  let parts: WorkWindow[] = [window];
  for (const g of gaps) {
    const next: WorkWindow[] = [];
    for (const p of parts) {
      if (g.end <= p.start || g.start >= p.end) {
        next.push(p);
        continue;
      }
      if (g.start > p.start) next.push({ start: p.start, end: g.start });
      if (g.end < p.end) next.push({ start: g.end, end: p.end });
    }
    parts = next;
  }
  return parts.filter((p) => p.end > p.start);
}

/**
 * Build the windows in which booster work happened for this order.
 * Pause intervals come from ORDER_PAUSED / ORDER_RESUMED order events.
 */
export function buildWorkWindows(
  assignments: WindowAssignment[],
  events: WindowEvent[],
  now: Date
): WorkWindow[] {
  const nowMs = now.getTime();
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const pauses: WorkWindow[] = [];
  let pausedAt: number | null = null;
  for (const e of sorted) {
    if (e.type === "ORDER_PAUSED" && pausedAt === null) pausedAt = e.createdAt.getTime();
    if (e.type === "ORDER_RESUMED" && pausedAt !== null) {
      pauses.push({ start: pausedAt, end: e.createdAt.getTime() });
      pausedAt = null;
    }
  }
  if (pausedAt !== null) pauses.push({ start: pausedAt, end: nowMs });

  const windows: WorkWindow[] = [];
  for (const a of assignments) {
    if (!a.startedAt || a.status === "DECLINED") continue;
    const start = a.startedAt.getTime();
    const end = a.endedAt ? a.endedAt.getTime() : nowMs;
    if (end <= start) continue;
    windows.push(...subtract({ start, end }, pauses));
  }
  return windows.sort((x, y) => x.start - y.start);
}

/** Who played a counted game (decision 2026-11-15: only session games are the booster's). */
export type PlayedBy = "BOOSTER" | "CUSTOMER" | "PAUSED";

/**
 * Sessions became mandatory with the Phase 4 release; assignments started
 * before it had no sessions, so their work windows (assignment minus pauses)
 * still count as the booster's.
 */
export const SESSIONS_REQUIRED_SINCE = new Date("2026-11-15T12:00:00.000Z");

export interface WindowSession {
  startedAt: Date;
  endedAt: Date | null;
}

/** Pause intervals from ORDER_PAUSED / ORDER_RESUMED events. */
export function pauseWindows(events: WindowEvent[], now: Date): WorkWindow[] {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out: WorkWindow[] = [];
  let pausedAt: number | null = null;
  for (const e of sorted) {
    if (e.type === "ORDER_PAUSED" && pausedAt === null) pausedAt = e.createdAt.getTime();
    if (e.type === "ORDER_RESUMED" && pausedAt !== null) {
      out.push({ start: pausedAt, end: e.createdAt.getTime() });
      pausedAt = null;
    }
  }
  if (pausedAt !== null) out.push({ start: pausedAt, end: now.getTime() });
  return out;
}

/** Whole time boosters held the order (pauses included): where games are looked for. */
export function scanWindows(assignments: WindowAssignment[], now: Date): WorkWindow[] {
  const nowMs = now.getTime();
  return assignments
    .filter((a) => a.startedAt && a.status !== "DECLINED")
    .map((a) => ({ start: a.startedAt!.getTime(), end: a.endedAt ? a.endedAt.getTime() : nowMs }))
    .filter((w) => w.end > w.start)
    .sort((x, y) => x.start - y.start);
}

/**
 * Booster play time: session windows minus pauses, plus (for assignments
 * started before sessions existed) the legacy work windows.
 */
export function boosterWindows(
  assignments: WindowAssignment[],
  sessions: WindowSession[],
  events: WindowEvent[],
  now: Date
): WorkWindow[] {
  const pauses = pauseWindows(events, now);
  const nowMs = now.getTime();
  const out: WorkWindow[] = [];
  for (const s of sessions) {
    const w = { start: s.startedAt.getTime(), end: s.endedAt ? s.endedAt.getTime() : nowMs };
    if (w.end > w.start) out.push(...subtract(w, pauses));
  }
  const legacy = assignments.filter((a) => a.startedAt && a.startedAt < SESSIONS_REQUIRED_SINCE);
  out.push(...buildWorkWindows(legacy, events, now));
  return out.sort((x, y) => x.start - y.start);
}

/** Inside a booster window -> BOOSTER; overlapping a pause -> PAUSED; else CUSTOMER. */
export function classifyGame(startMs: number, endMs: number, booster: WorkWindow[], pauses: WorkWindow[]): PlayedBy {
  if (booster.some((w) => startMs >= w.start && endMs <= w.end)) return "BOOSTER";
  if (pauses.some((p) => startMs < p.end && endMs > p.start)) return "PAUSED";
  return "CUSTOMER";
}

export type AttributionResult =
  | { attributed: true; playedBy: PlayedBy }
  | {
      attributed: false;
      reason: "not_participant" | "outside_window" | "wrong_queue" | "remake" | "incomplete";
    };

export function attributeMatch(input: {
  match: RiotMatchDto;
  puuid: string;
  /** Where games count at all (the order's scan windows). */
  windows: WorkWindow[];
  queueIds: number[];
  /** Booster play windows; omitted = every game in `windows` is the booster's. */
  booster?: WorkWindow[];
  pauses?: WorkWindow[];
}): AttributionResult {
  const { match, puuid, windows, queueIds } = input;
  const p = match.info.participants.find((x) => x.puuid === puuid);
  if (!p) return { attributed: false, reason: "not_participant" };
  if (!match.info.gameEndTimestamp) return { attributed: false, reason: "incomplete" };
  if (!queueIds.includes(match.info.queueId)) return { attributed: false, reason: "wrong_queue" };
  if (isRemake(match)) return { attributed: false, reason: "remake" };
  const start = match.info.gameStartTimestamp;
  const end = match.info.gameEndTimestamp;
  const inside = windows.some((w) => start >= w.start && end <= w.end);
  if (!inside) return { attributed: false, reason: "outside_window" };
  const playedBy = input.booster ? classifyGame(start, end, input.booster, input.pauses ?? []) : "BOOSTER";
  return { attributed: true, playedBy };
}

export interface OrderMatchRecord {
  matchId: string;
  queueId: number;
  championId: number;
  championName: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  durationSec: number;
  gameStartAt: Date;
  gameEndAt: Date;
}

/** Keep only the minimal stats shown in the workspace. */
export function toOrderMatchRecord(match: RiotMatchDto, puuid: string): OrderMatchRecord {
  const p = match.info.participants.find((x) => x.puuid === puuid);
  if (!p || !match.info.gameEndTimestamp) throw new Error("Match not attributable");
  return {
    matchId: match.metadata.matchId,
    queueId: match.info.queueId,
    championId: p.championId,
    championName: p.championName,
    win: p.win,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
    durationSec: match.info.gameDuration,
    gameStartAt: new Date(match.info.gameStartTimestamp),
    gameEndAt: new Date(match.info.gameEndTimestamp),
  };
}

export const MATCH_IDS_PAGE_SIZE = 100; // Riot maximum for `count`
/** Safety cap: 10 pages = 1,000 games in one window is not a real order. */
export const MATCH_IDS_MAX_PAGES = 10;

type Ctx = { correlationId?: string; orderId?: string };

/**
 * All Match-V5 match IDs for a PUUID in [startTime, endTime] (epoch
 * SECONDS, per Riot) for one queue, following `start` pagination until a
 * short page. `truncated` is true if the safety cap stopped it, in which
 * case the caller must not treat the range as fully scanned.
 */
export async function fetchMatchIds(
  client: RiotClient,
  platform: RiotPlatform,
  puuid: string,
  params: { startTime: number; endTime: number; queue: number },
  ctx: Ctx = {}
): Promise<{ ids: string[]; truncated: boolean }> {
  const { matchHost } = resolveRiotRouting(platform);
  const ids: string[] = [];
  for (let page = 0; page < MATCH_IDS_MAX_PAGES; page++) {
    const batch = await client.get(
      matchHost,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`,
      {
        schema: matchIdsSchema,
        query: {
          startTime: params.startTime,
          endTime: params.endTime,
          queue: params.queue,
          start: page * MATCH_IDS_PAGE_SIZE,
          count: MATCH_IDS_PAGE_SIZE,
        },
        ...ctx,
      }
    );
    for (const id of batch) if (!ids.includes(id)) ids.push(id);
    if (batch.length < MATCH_IDS_PAGE_SIZE) return { ids, truncated: false };
  }
  return { ids, truncated: true };
}

/** Match details are immutable once a game ends: cache them for an hour. */
export async function fetchMatch(
  client: RiotClient,
  platform: RiotPlatform,
  matchId: string,
  ctx: Ctx = {}
): Promise<RiotMatchDto> {
  const { matchHost } = resolveRiotRouting(platform);
  if (!MATCH_ID_PATTERN.test(matchId)) throw new Error("Invalid match id");
  return client.get(matchHost, `/lol/match/v5/matches/${matchId}`, {
    schema: matchSchema,
    cacheTtlMs: 60 * 60 * 1000,
    ...ctx,
  });
}
