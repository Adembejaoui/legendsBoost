/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing */
/**
 * Regression tests for the Riot audit (data integrity). They drive the real
 * sync service, Riot client, schemas and error classes against a scripted
 * fake Riot API and a stateful fake database with transaction rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeDb } from "./fake-db";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy({}, { get: (_t, k) => holder.db[k as string] }),
}));

import { syncOrderRiotData, INCREMENTAL_OVERLAP_MS, SYNC_LEASE_MS } from "@/lib/services/games/league-of-legends/sync.service";
import { createRiotClient } from "@/lib/services/games/league-of-legends/riot-client";

const PUUID = "puuid-current";
const START = new Date("2026-11-10T00:00:00Z");
const NOW = new Date("2026-11-12T00:00:00Z");

type Route = { status: number; body?: unknown; headers?: Record<string, string> } | (() => never);

function game(i: number, opts: { puuid?: string; queueId?: number; durationSec?: number; startMs?: number } = {}) {
  const s = opts.startMs ?? START.getTime() + (i + 1) * 3600_000;
  const duration = opts.durationSec ?? 1500;
  return {
    metadata: { matchId: `EUW1_${1000 + i}`, participants: [opts.puuid ?? PUUID] },
    info: {
      gameStartTimestamp: s,
      gameEndTimestamp: s + duration * 1000,
      gameDuration: duration,
      queueId: opts.queueId ?? 420,
      participants: [
        { puuid: opts.puuid ?? PUUID, championId: 62, championName: "MonkeyKing", win: i % 2 === 0, kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 150, neutralMinionsKilled: 10 },
      ],
    },
  };
}

/**
 * Scripted Riot API. `games` are what Match-V5 knows for the PUUID (ids are
 * listed newest first, filtered by startTime/endTime, paginated by start/count).
 */
function riotApi(opts: {
  games?: ReturnType<typeof game>[];
  accountPuuid?: string;
  accountStatus?: number;
  summonerStatus?: (puuid: string) => number;
  activeRegion?: string;
  idsStatus?: (puuid: string) => number;
  detail?: (matchId: string, n: number) => Route | undefined;
  entries?: unknown[];
}) {
  const games = opts.games ?? [];
  const calls: string[] = [];
  let detailCalls = 0;
  const fetch = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    const path = url.pathname;
    calls.push(`${url.host}${path}${url.search}`);
    const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

    if (path.startsWith("/riot/account/v1/accounts/by-riot-id/")) {
      if (opts.accountStatus && opts.accountStatus !== 200) return json(opts.accountStatus);
      return json(200, { puuid: opts.accountPuuid ?? PUUID, gameName: "Player", tagLine: "EUW" });
    }
    if (path.startsWith("/riot/account/v1/region/by-game/lol/by-puuid/")) {
      return opts.activeRegion ? json(200, { puuid: "x", game: "lol", region: opts.activeRegion }) : json(404);
    }
    if (path.startsWith("/lol/summoner/v4/summoners/by-puuid/")) {
      const puuid = decodeURIComponent(path.split("/").pop()!);
      const st = opts.summonerStatus?.(puuid) ?? 200;
      return st === 200 ? json(200, { puuid }) : json(st);
    }
    if (path.endsWith("/ids")) {
      const puuid = decodeURIComponent(path.split("/")[6]);
      const st = opts.idsStatus?.(puuid) ?? 200;
      if (st !== 200) return json(st);
      const startTime = Number(url.searchParams.get("startTime")) * 1000;
      const endTime = Number(url.searchParams.get("endTime")) * 1000;
      const queue = Number(url.searchParams.get("queue"));
      const start = Number(url.searchParams.get("start") ?? 0);
      const count = Number(url.searchParams.get("count") ?? 20);
      const ids = games
        .filter((g) => g.info.gameStartTimestamp >= startTime && g.info.gameStartTimestamp <= endTime && g.info.queueId === queue)
        .sort((a, b) => b.info.gameStartTimestamp - a.info.gameStartTimestamp)
        .map((g) => g.metadata.matchId);
      return json(200, ids.slice(start, start + count));
    }
    if (path.startsWith("/lol/match/v5/matches/")) {
      const id = path.split("/").pop()!;
      const scripted = opts.detail?.(id, ++detailCalls);
      // `return` lets TS narrow the union (the call throws either way).
      if (typeof scripted === "function") return scripted();
      if (scripted) return json(scripted.status, scripted.body ?? {}, scripted.headers);
      const g = games.find((x) => x.metadata.matchId === id);
      return g ? json(200, g) : json(404);
    }
    if (path.startsWith("/lol/league/v4/entries/by-puuid/")) return json(200, opts.entries ?? []);
    return json(404);
  });
  const log = vi.fn();
  const client = createRiotClient({ fetch: fetch as any, sleep: async () => {}, apiKey: () => "RGAPI-secret-test-key", log });
  return { client, fetch, calls, log };
}

function seed(account: Record<string, unknown> = {}, order: Record<string, unknown> = {}) {
  return createFakeDb({
    order: {
      id: "order-1",
      gameSlug: "league-of-legends",
      serviceSlug: "rank-boost",
      configuration: {},
      completedAt: null,
      assignments: [{ id: "as-1", status: "IN_PROGRESS", startedAt: START, endedAt: null }],
      events: [],
      // Started before sessions existed: the earlier attribution rule applies.
      sessions: [],
      ...order,
    },
    account: {
      id: "ra-1",
      orderId: "order-1",
      gameName: "player",
      tagLine: "euw",
      platform: "EUW1",
      puuid: null,
      linkStatus: "MANUAL",
      regionVerifiedAt: null,
      lastSyncedAt: null,
      lastSyncError: null,
      lastSyncErrorCode: null,
      matchScanUntil: null,
      pendingMatchIds: [],
      syncLeaseUntil: null,
      baselineAt: null,
      ...account,
    },
  });
}

const storedIds = (state: any) => state.matches.map((m: any) => m.matchId).sort();
const thirty = () => Array.from({ length: 30 }, (_, i) => game(i));

beforeEach(() => {
  vi.stubEnv("RIOT_API_KEY", "RGAPI-secret-test-key");
  vi.stubEnv("RIOT_API_KEY_TIER", "production");
  vi.stubEnv("RIOT_PRODUCT_APPROVED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("1. 30 matches with only 20 processed per sync", () => {
  it("keeps the overflow pending and stores all 30 across two syncs, without duplicates", async () => {
    const f = seed();
    holder.db = f.db;
    const games = thirty();
    const api = riotApi({ games });

    const first = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(first).toMatchObject({ status: "synced", newMatches: 20, pendingMatches: 10, complete: false });
    expect(f.state.account.pendingMatchIds).toHaveLength(10);
    expect(f.state.account.matchScanUntil).toEqual(NOW);

    const later = new Date(NOW.getTime() + 60_000);
    const second = await syncOrderRiotData("order-1", { client: api.client, now: later });
    expect(second).toMatchObject({ status: "synced", newMatches: 10, pendingMatches: 0, complete: true });
    expect(storedIds(f.state)).toEqual(games.map((g) => g.metadata.matchId).sort());
    expect(new Set(storedIds(f.state)).size).toBe(30);
  });

  it("processes oldest games first and re-scans with an overlap before the cursor", async () => {
    const f = seed();
    holder.db = f.db;
    const games = thirty();
    const api = riotApi({ games });
    await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(storedIds(f.state)).toEqual(games.slice(0, 20).map((g) => g.metadata.matchId).sort());

    api.calls.length = 0;
    await syncOrderRiotData("order-1", { client: api.client, now: new Date(NOW.getTime() + 60_000) });
    const idsCall = api.calls.find((c) => c.includes("/ids"))!;
    const startTime = Number(new URL(`https://${idsCall}`).searchParams.get("startTime"));
    expect(startTime).toBe(Math.floor((NOW.getTime() - INCREMENTAL_OVERLAP_MS) / 1000));
  });

  it("finds a game that was still running at the last scan (overlap)", async () => {
    const f = seed();
    holder.db = f.db;
    const running = game(99, { startMs: NOW.getTime() - 20 * 60_000 }); // started before the scan, ended after
    const api = riotApi({ games: [] });
    await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    const api2 = riotApi({ games: [running] });
    const out = await syncOrderRiotData("order-1", { client: api2.client, now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(out).toMatchObject({ newMatches: 1 });
  });
});

describe("2. interrupted synchronization", () => {
  it("a crash mid-sync loses nothing: committed matches stay, the rest stay pending, the lease expires", async () => {
    const f = seed();
    holder.db = f.db;
    const games = thirty();
    // The 6th commit fails unexpectedly (e.g. the function is killed / DB drops).
    const realTx = f.db.$transaction;
    let commits = 0;
    f.db.$transaction = async (cb: any) => {
      if (++commits === 6) throw new Error("process killed");
      return realTx(cb);
    };
    const api = riotApi({ games });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    f.db.$transaction = realTx;
    expect(out.status).toBe("error");
    expect(f.state.matches).toHaveLength(5);
    expect(f.state.account.pendingMatchIds).toHaveLength(25);

    // Simulate a hard crash that never released the lease.
    f.state.account.syncLeaseUntil = new Date(NOW.getTime() + SYNC_LEASE_MS);
    const busy = await syncOrderRiotData("order-1", { client: riotApi({ games }).client, now: new Date(NOW.getTime() + 1000) });
    expect(busy.status).toBe("busy");

    const resumed = riotApi({ games });
    const after = new Date(NOW.getTime() + SYNC_LEASE_MS + 1000);
    await syncOrderRiotData("order-1", { client: resumed.client, now: after });
    await syncOrderRiotData("order-1", { client: resumed.client, now: new Date(after.getTime() + 1000) });
    expect(new Set(storedIds(f.state)).size).toBe(30);
    expect(f.state.account.pendingMatchIds).toEqual([]);
  });
});

describe("3/4. partial success followed by 429 or 500", () => {
  it("429 (Retry-After 30): keeps fetched matches, returns retryAfter, makes no further calls", async () => {
    const f = seed();
    holder.db = f.db;
    const api = riotApi({ games: thirty(), detail: (_id, n) => (n === 8 ? { status: 429, headers: { "Retry-After": "30" } } : undefined) });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(out).toMatchObject({ status: "error", retryAfterSec: 30, newMatches: 7, pendingMatches: 23 });
    expect(f.state.matches).toHaveLength(7);
    expect(api.calls.filter((c) => /\/matches\/EUW1_/.test(c))).toHaveLength(8); // no retry storm
    expect(f.state.account.lastSyncErrorCode).toBe("rate_limited");
    expect(f.state.account.syncLeaseUntil).toBeNull();
  });

  it("500 after bounded retries: keeps fetched matches; the failed match stays pending", async () => {
    const f = seed();
    holder.db = f.db;
    const games = thirty();
    const failingId = games[3].metadata.matchId; // 4th oldest
    const api = riotApi({ games, detail: (id) => (id === failingId ? { status: 500 } : undefined) });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(out).toMatchObject({ status: "error", newMatches: 3 });
    expect(f.state.account.pendingMatchIds[0]).toBe(failingId);
    expect(api.calls.filter((c) => c.endsWith(failingId))).toHaveLength(3); // 1 + 2 retries, then stop
    expect(f.state.account.lastSyncErrorCode).toBe("outage");
  });
});

describe("8. incorrect platform region", () => {
  it("a Riot ID that exists but not on the region is an actionable error, not an empty success", async () => {
    const f = seed({ platform: "NA1" });
    holder.db = f.db;
    const api = riotApi({ games: thirty(), summonerStatus: () => 404, activeRegion: "euw1" });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(out).toMatchObject({ status: "account_error", code: "wrong_region", suggestedPlatform: "EUW1" });
    expect((out as any).reason).toMatch(/North America \(NA1\).*Europe West \(EUW1\)/);
    expect(f.state.account).toMatchObject({ puuid: null, linkStatus: "MANUAL", lastSyncErrorCode: "wrong_region" });
    expect(api.calls.some((c) => c.includes("/ids") || c.includes("/league/"))).toBe(false);
    expect(f.state.matches).toHaveLength(0);
  });

  it("a nonexistent Riot ID is reported differently from a wrong region", async () => {
    const f = seed();
    holder.db = f.db;
    const out = await syncOrderRiotData("order-1", { client: riotApi({ accountStatus: 404 }).client, now: NOW });
    expect(out).toMatchObject({ status: "account_error", code: "not_found" });
    expect(f.state.account.lastSyncErrorCode).toBe("not_found");
  });

  it("a confirmed region stores the PUUID, Riot's canonical Riot ID and is checked only once", async () => {
    const f = seed();
    holder.db = f.db;
    const api = riotApi({});
    await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(f.state.account).toMatchObject({ puuid: PUUID, linkStatus: "RESOLVED", gameName: "Player", tagLine: "EUW" });
    expect(f.state.account.regionVerifiedAt).toEqual(NOW);
    const summonerCalls = () => api.calls.filter((c) => c.includes("/summoner/")).length;
    const afterFirst = summonerCalls();
    await syncOrderRiotData("order-1", { client: api.client, now: new Date(NOW.getTime() + 60_000) });
    // The second sync does not re-check the region: its only Summoner-V4
    // call is the profile snapshot (level / icon).
    expect(summonerCalls() - afterFirst).toBeLessThanOrEqual(1);
  });

  it("an account stored with a now-unsupported region asks for a new region", async () => {
    const f = seed({ platform: "PH2" });
    holder.db = f.db;
    const out = await syncOrderRiotData("order-1", { client: riotApi({}).client, now: NOW });
    expect(out).toMatchObject({ status: "needs_account" });
    expect((out as any).reason).toMatch(/PH2/);
  });
});

describe("10. invalid PUUID recovery", () => {
  it("a 400 on a stored PUUID re-resolves the Riot ID once and retries with the new PUUID", async () => {
    const f = seed({ puuid: "puuid-old", linkStatus: "RESOLVED", regionVerifiedAt: START });
    holder.db = f.db;
    const games = [game(0), game(1)];
    const api = riotApi({ games, idsStatus: (p) => (p === "puuid-old" ? 400 : 200) });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(out).toMatchObject({ status: "synced", newMatches: 2 });
    expect(f.state.account.puuid).toBe(PUUID);
    expect(api.calls.filter((c) => c.includes("/by-riot-id/"))).toHaveLength(1);
  });

  it("keeps the old PUUID and stops (no loop) when Riot returns the same PUUID", async () => {
    const f = seed({ puuid: PUUID, linkStatus: "RESOLVED", regionVerifiedAt: START });
    holder.db = f.db;
    const api = riotApi({ games: [game(0)], idsStatus: () => 400 });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(out.status).toBe("error");
    expect(f.state.account.puuid).toBe(PUUID);
    expect(api.calls.filter((c) => c.includes("/by-riot-id/"))).toHaveLength(1);
    expect(api.calls.filter((c) => c.includes("/ids"))).toHaveLength(1);
  });

  it("keeps the old PUUID when the re-lookup fails", async () => {
    const f = seed({ puuid: "puuid-old", linkStatus: "RESOLVED", regionVerifiedAt: START });
    holder.db = f.db;
    const api = riotApi({ accountStatus: 503, idsStatus: () => 400 });
    await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(f.state.account.puuid).toBe("puuid-old");
  });
});

describe("11. duplicate prevention", () => {
  it("re-scans and an id already stored never create a second row", async () => {
    const games = [game(0), game(1), game(2)];
    const f = seed({ puuid: PUUID, regionVerifiedAt: START, linkStatus: "RESOLVED" });
    // Pre-existing row for game 0 AND the same id left in the pending list.
    f.state.matches.push({ id: "m-pre", orderId: "order-1", matchId: games[0].metadata.matchId });
    f.state.account.pendingMatchIds = [games[0].metadata.matchId];
    holder.db = f.db;
    const api = riotApi({ games });
    await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    await syncOrderRiotData("order-1", { client: api.client, now: new Date(NOW.getTime() + 60_000) });
    expect(storedIds(f.state)).toEqual(games.map((g) => g.metadata.matchId).sort());
  });
});

describe("13. concurrent synchronization requests", () => {
  it("only one of two simultaneous syncs runs; the other is refused as busy", async () => {
    const f = seed();
    holder.db = f.db;
    const api = riotApi({ games: thirty() });
    const [a, b] = await Promise.all([
      syncOrderRiotData("order-1", { client: api.client, now: NOW }),
      syncOrderRiotData("order-1", { client: api.client, now: NOW }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["busy", "synced"]);
    expect(new Set(storedIds(f.state)).size).toBe(f.state.matches.length);
  });

  it("an account change during a sync stops it before any data is written to the new account", async () => {
    const f = seed();
    holder.db = f.db;
    const games = thirty();
    const api = riotApi({
      games,
      detail: (_id, n) => {
        if (n === 3) f.state.account = { ...f.state.account, gameName: "Someone", tagLine: "ELSE", puuid: null, pendingMatchIds: [] };
        return undefined;
      },
    });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(out.status).toBe("error");
    expect(f.state.matches).toHaveLength(2); // the 3rd write was refused and rolled back
    expect(f.calls.rollbacks).toBe(1);
  });
});

describe("work windows, baseline and safety (existing behaviour kept)", () => {
  it("does nothing when official access is not approved", async () => {
    vi.stubEnv("RIOT_PRODUCT_APPROVED", "false");
    const f = seed();
    holder.db = f.db;
    const api = riotApi({});
    expect((await syncOrderRiotData("order-1", { client: api.client, now: NOW })).status).toBe("unavailable");
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("stores games inside the order window; a game during a pause is kept and labelled PAUSED (Phase 5)", async () => {
    const pausedAt = new Date(START.getTime() + 5 * 3600_000);
    const resumedAt = new Date(START.getTime() + 8 * 3600_000);
    const f = seed({}, {
      events: [
        { type: "ORDER_PAUSED", createdAt: pausedAt },
        { type: "ORDER_RESUMED", createdAt: resumedAt },
      ],
    });
    holder.db = f.db;
    const before = game(50, { startMs: START.getTime() - 3600_000 });
    const duringPause = game(51, { startMs: START.getTime() + 6 * 3600_000 });
    const ok = game(52, { startMs: START.getTime() + 9 * 3600_000 });
    const flex = game(53, { startMs: START.getTime() + 10 * 3600_000, queueId: 440 });
    await syncOrderRiotData("order-1", { client: riotApi({ games: [before, duringPause, ok, flex] }).client, now: NOW });
    // Before the order and other queues are ignored; the paused game is kept but does not count.
    expect(storedIds(f.state)).toEqual([duringPause.metadata.matchId, ok.metadata.matchId]);
    const byId = Object.fromEntries(f.state.matches.map((m: any) => [m.matchId, m.playedBy]));
    expect(byId).toEqual({ [duringPause.metadata.matchId]: "PAUSED", [ok.metadata.matchId]: "BOOSTER" });
  });

  it("queries Match-V5 on the regional host in epoch seconds", async () => {
    const f = seed({ puuid: PUUID, regionVerifiedAt: START });
    holder.db = f.db;
    const api = riotApi({});
    await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    const ids = new URL(`https://${api.calls.find((c) => c.includes("/ids"))!}`);
    expect(ids.host).toBe("europe.api.riotgames.com");
    expect(Number(ids.searchParams.get("startTime"))).toBe(START.getTime() / 1000);
    expect(Number(ids.searchParams.get("endTime"))).toBe(NOW.getTime() / 1000);
    expect(ids.searchParams.get("queue")).toBe("420");
  });

  it("captures a Riot baseline only while no order game exists (stored or pending)", async () => {
    const entries = [{ queueType: "RANKED_SOLO_5x5", tier: "DIAMOND", rank: "IV", leaguePoints: 35, wins: 1, losses: 1 }];
    const f = seed({ puuid: PUUID, regionVerifiedAt: START });
    holder.db = f.db;
    await syncOrderRiotData("order-1", { client: riotApi({ entries }).client, now: NOW });
    expect(f.state.account).toMatchObject({ observedTier: "DIAMOND", observedLp: 35, baselineTier: "DIAMOND", baselineSource: "riot" });

    const g = seed({ puuid: PUUID, regionVerifiedAt: START });
    holder.db = g.db;
    await syncOrderRiotData("order-1", { client: riotApi({ entries, games: [game(0)] }).client, now: NOW });
    expect(g.state.account.baselineTier).toBeUndefined();
  });

  it("never leaks the API key in outcomes, stored errors or logs", async () => {
    const f = seed({ puuid: PUUID, regionVerifiedAt: START });
    holder.db = f.db;
    const api = riotApi({ idsStatus: () => 403 });
    const out = await syncOrderRiotData("order-1", { client: api.client, now: NOW });
    expect(JSON.stringify(out) + JSON.stringify(f.state.account) + JSON.stringify(api.log.mock.calls)).not.toContain("RGAPI");
  });
});
