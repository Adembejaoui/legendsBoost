/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing */
import { describe, it, expect, vi } from "vitest";
import {
  createRiotClient,
  endpointFamily,
  RiotAuthError,
  RiotInvalidResponseError,
  RiotRateLimitedError,
  RiotUnavailableError,
} from "@/lib/services/games/league-of-legends/riot-client";
import { createDbRiotLimiter, createMemoryRiotLimiter, keyFingerprint } from "@/lib/services/games/league-of-legends/rate-limiter";
import { getRiotApiKey, getRiotApiKeySource, getRiotRateLimits } from "@/lib/services/games/league-of-legends/capabilities";
import { computeRankProgress } from "@/lib/services/games/league-of-legends/progression.service";
import { fetchMatchIds, isRemake, MATCH_IDS_MAX_PAGES } from "@/lib/services/games/league-of-legends/match-history.service";
import { pickQueueRank } from "@/lib/services/games/league-of-legends/rank.service";
import { leagueEntriesSchema, matchSchema, accountSchema } from "@/lib/services/games/league-of-legends/riot.schemas";
import {
  RIOT_PLATFORMS,
  isRiotPlatform,
  riotPlatformSchema,
  unsupportedPlatformReason,
  resolveRiotRouting,
} from "@/lib/services/games/league-of-legends/routing";
import { parseDdragonChampions, resolveMatchChampion } from "@/lib/services/games/league-of-legends/champion-assets";
import type { SourcedRank } from "@/lib/services/games/league-of-legends/riot.types";

const KEY = "RGAPI-00000000-1111-2222-3333-444444444444";
const HOST = "europe.api.riotgames.com";
const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

// ---------------------------------------------------------------------------
describe("9. current rank comes only from Riot (manual reports removed)", () => {
  const NOW = new Date("2026-11-12T12:00:00Z");
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
  const riot = (tier: string, division: string | null, lp: number, at: Date): SourcedRank => ({ tier: tier as any, division: division as any, lp, source: "riot", at });
  const start = riot("DIAMOND", "IV", 35, ago(60 * 48));
  const target = { tier: "MASTER" as const, division: null, lp: 0 };

  it("fresh Riot data drives progress", () => {
    const p = computeRankProgress({ start, current: riot("DIAMOND", "II", 10, ago(30)), target, now: NOW });
    expect(p.status).toBe("in_progress");
    expect(p.stale).toBe(false);
  });

  it("a stale Riot observation is still the current rank, flagged stale (nothing replaces it)", () => {
    const p = computeRankProgress({ start, current: riot("DIAMOND", "II", 10, ago(60 * 30)), target, now: NOW });
    expect(p).toMatchObject({ status: "in_progress", stale: true });
  });

  it("with no Riot data there is no current rank and no progress is invented", () => {
    const p = computeRankProgress({ start, current: null, target, now: NOW });
    expect(p).toMatchObject({ status: "unavailable", percent: null, lpDelta: null });
  });
});

// ---------------------------------------------------------------------------
describe("12. pagination beyond 100 match IDs", () => {
  function pagedClient(total: number) {
    const all = Array.from({ length: total }, (_, i) => `EUW1_${5000 - i}`);
    const get = vi.fn(async (_h: string, _p: string, o: any) => all.slice(o.query.start, o.query.start + o.query.count));
    return { client: { get } as any, get, all };
  }

  it("follows start/count until a short page (230 ids -> 3 requests)", async () => {
    const { client, get, all } = pagedClient(230);
    const out = await fetchMatchIds(client, "EUW1", "p", { startTime: 1, endTime: 2, queue: 420 });
    expect(out).toEqual({ ids: all, truncated: false });
    expect(get.mock.calls.map((c: any[]) => [c[2].query.start, c[2].query.count])).toEqual([[0, 100], [100, 100], [200, 100]]);
    expect(get.mock.calls[0][0]).toBe("europe.api.riotgames.com");
  });

  it("exactly 100 ids needs one extra (empty) page to know it is complete", async () => {
    const { client, get } = pagedClient(100);
    expect((await fetchMatchIds(client, "EUW1", "p", { startTime: 1, endTime: 2, queue: 420 })).truncated).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops at the safety cap and reports truncation (the sync then keeps its cursor)", async () => {
    const { client, get } = pagedClient(5000);
    const out = await fetchMatchIds(client, "EUW1", "p", { startTime: 1, endTime: 2, queue: 420 });
    expect(out.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(MATCH_IDS_MAX_PAGES);
  });
});

// ---------------------------------------------------------------------------
/** Emulates the riotApiThrottle SQL so the shared-limiter logic can be tested without Postgres. */
function fakeThrottleDb(clock: { now: number }) {
  const rows = new Map<string, { windowStart: number; count: number; blockedUntil: number | null }>();
  const db = {
    fail: false,
    rows,
    // RawQueryClient mirrors Prisma's generic `$queryRaw<T>`, whose row type
    // is unchecked by design; the fake narrows at this single boundary.
    $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      return db.query(strings, ...values) as Promise<T>;
    },
    async query(strings: TemplateStringsArray, ...values: any[]) {
      if (db.fail) throw new Error("db down");
      const sql = strings.join("?");
      if (sql.includes('SELECT (EXTRACT(EPOCH FROM ("blockedUntil"')) {
        const r = rows.get(values[0]);
        return r?.blockedUntil ? [{ waitMs: r.blockedUntil - clock.now }] : [];
      }
      if (sql.includes('"blockedUntil", "updatedAt")')) {
        const [key, sec] = values;
        const r = rows.get(key) ?? { windowStart: clock.now, count: 0, blockedUntil: null };
        r.blockedUntil = Math.max(r.blockedUntil ?? 0, clock.now + sec * 1000);
        rows.set(key, r);
        return [{ key }];
      }
      if (sql.includes('INSERT INTO "riotApiThrottle" ("key", "windowStart", "count", "updatedAt")')) {
        const windowSec = values[0];
        const key = values[2];
        const ms = windowSec * 1000;
        const ws = Math.floor(clock.now / ms) * ms;
        const r = rows.get(key);
        const count = r && r.windowStart === ws ? r.count + 1 : 1;
        rows.set(key, { windowStart: ws, count, blockedUntil: null });
        return [{ count, waitMs: ws + ms - clock.now }];
      }
      throw new Error("unexpected SQL");
    },
  };
  return db;
}

describe("14. shared rate-limit enforcement", () => {
  function instances(limits: { max: number; windowSec: number }[]) {
    const clock = { now: 1_800_000_000_000 };
    const db = fakeThrottleDb(clock);
    const fetch = vi.fn(async () => json(200, []));
    const make = () =>
      createRiotClient({
        fetch: fetch as any,
        now: () => clock.now,
        sleep: vi.fn(async (ms: number) => {
          clock.now += ms;
        }),
        apiKey: () => KEY,
        log: () => {},
        limiter: createDbRiotLimiter({ db, apiKey: () => KEY, limits: () => limits }),
      });
    return { a: make(), b: make(), db, fetch, clock };
  }

  it("two serverless instances share one budget per key and host", async () => {
    const { a, b, fetch } = instances([{ max: 3, windowSec: 10 }]);
    await a.get(HOST, "/lol/match/v5/matches/x");
    await b.get(HOST, "/lol/match/v5/matches/y");
    await a.get(HOST, "/lol/match/v5/matches/z");
    // The 4th call (on instance B) exceeds the shared budget: the remaining
    // window (10s) is too long to wait inline, so it fails fast without calling Riot.
    await expect(b.get(HOST, "/lol/match/v5/matches/w")).rejects.toBeInstanceOf(RiotRateLimitedError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("budgets are separate per routing host (Riot limits are per region)", async () => {
    const { a, fetch } = instances([{ max: 1, windowSec: 10 }]);
    await a.get(HOST, "/x");
    await a.get("americas.api.riotgames.com", "/x");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a short wait for the next window is taken inline", async () => {
    const { a, fetch, clock } = instances([{ max: 1, windowSec: 1 }]);
    clock.now = Math.floor(clock.now / 1000) * 1000 + 400; // 600ms left in the window
    await a.get(HOST, "/x");
    await a.get(HOST, "/y");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a 429 seen by one instance stops the others for Retry-After (no retry storm)", async () => {
    const { a, b, fetch, clock } = instances([]);
    fetch.mockResolvedValueOnce(json(429, {}, { "Retry-After": "60" }));
    await expect(a.get(HOST, "/x")).rejects.toBeInstanceOf(RiotRateLimitedError);
    await expect(b.get(HOST, "/y")).rejects.toBeInstanceOf(RiotRateLimitedError);
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.now += 61_000;
    await expect(b.get(HOST, "/y")).resolves.toEqual([]);
  });

  it("fails closed when the shared limiter is unavailable", async () => {
    const { a, db, fetch } = instances([{ max: 5, windowSec: 1 }]);
    db.fail = true;
    await expect(a.get(HOST, "/x")).rejects.toBeInstanceOf(RiotUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores only a key fingerprint, never the key", async () => {
    const { a, db } = instances([{ max: 5, windowSec: 1 }]);
    await a.get(HOST, "/x");
    const keys = [...db.rows.keys()].join(" ");
    expect(keys).toContain(keyFingerprint(KEY));
    expect(keys).not.toContain(KEY);
    expect(keyFingerprint(KEY)).toHaveLength(16);
  });

  it("tier limits follow Riot's published values with a safety margin; overridable", () => {
    expect(getRiotRateLimits({ RIOT_API_KEY_TIER: "production" })).toEqual([{ max: 400, windowSec: 10 }, { max: 24_000, windowSec: 600 }]);
    expect(getRiotRateLimits({ RIOT_API_KEY_TIER: "personal" })).toEqual([{ max: 16, windowSec: 1 }, { max: 80, windowSec: 120 }]);
    expect(getRiotRateLimits({})).toEqual(getRiotRateLimits({ RIOT_API_KEY_TIER: "personal" }));
    expect(getRiotRateLimits({ RIOT_RATE_LIMITS: "50:1,1000:60" })).toEqual([{ max: 40, windowSec: 1 }, { max: 800, windowSec: 60 }]);
    expect(getRiotRateLimits({ RIOT_RATE_LIMITS: "garbage", RIOT_API_KEY_TIER: "personal" })).toEqual([{ max: 16, windowSec: 1 }, { max: 80, windowSec: 120 }]);
  });

  it("the in-memory limiter (tests/local) enforces the same windows", async () => {
    let now = 0;
    const l = createMemoryRiotLimiter({ now: () => now, limits: [{ max: 2, windowSec: 1 }] });
    expect(await l.acquire(HOST)).toBe(0);
    expect(await l.acquire(HOST)).toBe(0);
    expect(await l.acquire(HOST)).toBe(1000);
    now = 1000;
    expect(await l.acquire(HOST)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("15. API error diagnostics", () => {
  function client(response: () => Response | Promise<Response>, tier = "development") {
    const log = vi.fn();
    const c = createRiotClient({ fetch: vi.fn(async () => response()) as any, sleep: async () => {}, apiKey: () => KEY, log, keyTier: () => tier });
    return { c, log };
  }
  const call = (c: any) => c.get("euw1.api.riotgames.com", "/lol/league/v4/entries/by-puuid/p", { correlationId: "corr-1", orderId: "order-9" });

  it("403 on a development key: forbidden, with the 24h-expiry hint in the server log only", async () => {
    const { c, log } = client(() => json(403));
    const err = await call(c).catch((e: any) => e);
    expect(err).toBeInstanceOf(RiotAuthError);
    expect(err.kind).toBe("forbidden");
    expect(err.message).not.toMatch(/24 hours/);
    expect(log.mock.calls[0][0]).toMatchObject({
      kind: "forbidden",
      status: 403,
      endpointFamily: "league-v4",
      host: "euw1.api.riotgames.com",
      correlationId: "corr-1",
      orderId: "order-9",
    });
    expect(log.mock.calls[0][0].hint).toMatch(/deactivate every 24 hours/);
  });

  it("403 on a production key: invalid / revoked key or endpoint not permitted", async () => {
    const { c, log } = client(() => json(403), "production");
    await call(c).catch(() => {});
    expect(log.mock.calls[0][0].hint).toMatch(/not permitted/);
  });

  it("401 is reported as unauthorized (no credentials reached Riot)", async () => {
    const { c, log } = client(() => json(401));
    expect((await call(c).catch((e: any) => e)).kind).toBe("unauthorized");
    expect(log.mock.calls[0][0].kind).toBe("unauthorized");
  });

  it("network failure, outage, 429 and bad responses each get their own kind", async () => {
    const network = client(() => {
      throw new TypeError("fetch failed");
    });
    expect((await call(network.c).catch((e: any) => e)).kind).toBe("network");
    expect((await call(client(() => json(503)).c).catch((e: any) => e)).kind).toBe("outage");
    const limited = client(() => json(429, {}, { "Retry-After": "90", "X-Rate-Limit-Type": "application" }));
    const e429 = await call(limited.c).catch((e: any) => e);
    expect(e429).toMatchObject({ kind: "rate_limited", retryAfterSec: 90 });
    expect(limited.log.mock.calls[0][0].rateLimitType).toBe("application");
    const bad = createRiotClient({ fetch: vi.fn(async () => json(200, { nope: true })) as any, apiKey: () => KEY, log: () => {} });
    await expect(bad.get(HOST, "/riot/account/v1/accounts/by-riot-id/a/b", { schema: accountSchema })).rejects.toBeInstanceOf(RiotInvalidResponseError);
  });

  it("404 is an answer, not logged as a fault", async () => {
    const { c, log } = client(() => json(404));
    expect((await call(c).catch((e: any) => e)).kind).toBe("not_found");
    expect(log).not.toHaveBeenCalled();
  });

  it("never logs the key or headers", async () => {
    const { c, log } = client(() => json(403));
    await call(c).catch(() => {});
    const text = JSON.stringify(log.mock.calls);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/X-Riot-Token/i);
  });

  it("endpoint families", () => {
    expect(endpointFamily("/riot/account/v1/accounts/by-riot-id/a/b")).toBe("account-v1");
    expect(endpointFamily("/lol/match/v5/matches/EUW1_1")).toBe("match-v5");
    expect(endpointFamily("/lol/summoner/v4/summoners/by-puuid/x")).toBe("summoner-v4");
  });

  it("canonical key variable is RIOT_API_KEY; RIOT_LOL_API_KEY still works as a fallback", () => {
    expect(getRiotApiKey({ RIOT_API_KEY: "a", RIOT_LOL_API_KEY: "b" })).toBe("a");
    expect(getRiotApiKey({ RIOT_LOL_API_KEY: "b" })).toBe("b");
    expect(getRiotApiKeySource({ RIOT_LOL_API_KEY: "b" })).toBe("RIOT_LOL_API_KEY");
    expect(getRiotApiKey({ RIOT_API_KEY: "your_key_here" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("16. missing optional Riot response fields", () => {
  const baseParticipant = { puuid: "p", championId: 1, win: true };
  const baseMatch = (participant: object, info: object = {}) => ({
    metadata: { matchId: "EUW1_1" },
    info: { gameStartTimestamp: 1, gameDuration: 1500, queueId: 420, participants: [participant], ...info },
  });

  it("participant counters and championName default; metadata.participants optional", () => {
    const m = matchSchema.parse(baseMatch(baseParticipant, { gameEndTimestamp: 2 }));
    expect(m.info.participants[0]).toMatchObject({ kills: 0, deaths: 0, assists: 0, totalMinionsKilled: 0, neutralMinionsKilled: 0, championName: "" });
    expect(m.metadata.participants).toEqual([]);
  });

  it("missing gameEndTimestamp is allowed by the schema but never attributed", () => {
    expect(matchSchema.parse(baseMatch(baseParticipant)).info.gameEndTimestamp).toBeUndefined();
  });

  it("fields that decide attribution are required", () => {
    expect(matchSchema.safeParse(baseMatch({ championId: 1, win: true })).success).toBe(false); // no puuid
    expect(matchSchema.safeParse(baseMatch({ puuid: "p", championId: 1 })).success).toBe(false); // no win
    expect(matchSchema.safeParse({ metadata: { matchId: "bad id" }, info: {} }).success).toBe(false);
  });

  it("league entries: missing wins/losses default, missing tier means unranked in that queue", () => {
    const entries = leagueEntriesSchema.parse([{ queueType: "RANKED_SOLO_5x5", leaguePoints: 10 }, { queueType: "RANKED_FLEX_SR", tier: "GOLD", rank: "II" }]);
    expect(entries[0]).toMatchObject({ wins: 0, losses: 0 });
    expect(pickQueueRank(entries, "RANKED_SOLO_5x5")).toBeNull();
    expect(pickQueueRank(entries, "RANKED_FLEX_SR")).toEqual({ tier: "GOLD", division: "II", lp: 0 });
  });

  it("apex entries ignore the division Riot sends", () => {
    const entries = leagueEntriesSchema.parse([{ queueType: "RANKED_SOLO_5x5", tier: "MASTER", rank: "I", leaguePoints: 120 }]);
    expect(pickQueueRank(entries, "RANKED_SOLO_5x5")).toEqual({ tier: "MASTER", division: null, lp: 120 });
  });

  it("remakes: early surrender on any participant, or a game too short to be real", () => {
    const g = (p: object, dur: number) => matchSchema.parse(baseMatch({ ...baseParticipant, ...p }, { gameEndTimestamp: 2, gameDuration: dur }));
    expect(isRemake(g({ gameEndedInEarlySurrender: true }, 210))).toBe(true);
    expect(isRemake(g({ gameEndedInEarlySurrender: true }, 330))).toBe(true);
    expect(isRemake(g({}, 200))).toBe(true); // field missing, too short
    expect(isRemake(g({ gameEndedInEarlySurrender: false }, 1500))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("17. unsupported regions", () => {
  it("PH2, TH2 and ME1 are not selectable and are rejected at input", () => {
    for (const p of ["PH2", "TH2", "ME1"]) {
      expect(RIOT_PLATFORMS).not.toContain(p);
      expect(isRiotPlatform(p)).toBe(false);
      expect(riotPlatformSchema.safeParse(p).success).toBe(false);
      expect(() => resolveRiotRouting(p)).toThrow();
      expect(unsupportedPlatformReason(p.toLowerCase())).toMatch(new RegExp(p));
    }
  });

  it("supported platforms all route to a documented regional host", () => {
    expect(RIOT_PLATFORMS).toHaveLength(14);
    expect(resolveRiotRouting("SG2")).toMatchObject({ matchHost: "sea.api.riotgames.com", accountHost: "asia.api.riotgames.com" });
    expect(resolveRiotRouting("EUN1")).toMatchObject({ matchHost: "europe.api.riotgames.com", platformHost: "eun1.api.riotgames.com" });
    expect(unsupportedPlatformReason("EUW1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("18. champion identification through championId", () => {
  // Shape verified against Data Dragon 16.22.1 champion.json.
  const champions = parseDdragonChampions({
    data: {
      MonkeyKing: { id: "MonkeyKing", key: "62", name: "Wukong" },
      Fiddlesticks: { id: "Fiddlesticks", key: "9", name: "Fiddlesticks" },
      Broken: { id: "../evil", key: "1", name: "x" },
    },
  });

  it("maps numeric keys to Data Dragon ids and skips unsafe entries", () => {
    expect(champions[62]).toEqual({ id: "MonkeyKing", name: "Wukong" });
    expect(champions[1]).toBeUndefined();
  });

  it("championId wins over Match-V5 championName (FiddleSticks vs Fiddlesticks)", () => {
    expect(resolveMatchChampion("16.22.1", champions, 9, "FiddleSticks")).toEqual({
      name: "Fiddlesticks",
      icon: "https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/Fiddlesticks.png",
    });
    expect(resolveMatchChampion("16.22.1", champions, 62, "MonkeyKing").name).toBe("Wukong");
  });

  it("falls back to the name when Data Dragon is unavailable", () => {
    expect(resolveMatchChampion("16.22.1", null, 62, "MonkeyKing")).toEqual({
      name: "MonkeyKing",
      icon: "https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/MonkeyKing.png",
    });
    expect(resolveMatchChampion(null, null, 62, "MonkeyKing").icon).toBeNull();
  });
});
