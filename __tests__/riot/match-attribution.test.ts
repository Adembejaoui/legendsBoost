import { describe, it, expect } from "vitest";
import {
  attributeMatch,
  buildWorkWindows,
  getOrderQueueIds,
  toOrderMatchRecord,
} from "@/lib/services/games/league-of-legends/match-history.service";
import type { RiotMatchDto } from "@/lib/services/games/league-of-legends/riot.types";

const T = (iso: string) => new Date(iso);
const ms = (iso: string) => T(iso).getTime();
const PUUID = "puuid-order-account";

function match(opts: {
  id?: string;
  start: string;
  minutes?: number;
  queueId?: number;
  puuid?: string;
  win?: boolean;
  remake?: boolean;
  ended?: boolean;
}): RiotMatchDto {
  const start = ms(opts.start);
  const dur = (opts.minutes ?? 30) * 60;
  return {
    metadata: { matchId: opts.id ?? "EUW1_1", participants: [opts.puuid ?? PUUID] },
    info: {
      gameStartTimestamp: start,
      gameEndTimestamp: opts.ended === false ? undefined : start + dur * 1000,
      gameDuration: dur,
      queueId: opts.queueId ?? 420,
      participants: [
        {
          puuid: opts.puuid ?? PUUID,
          championId: 103,
          championName: "Ahri",
          win: opts.win ?? true,
          kills: 8,
          deaths: 2,
          assists: 5,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          gameEndedInEarlySurrender: opts.remake ?? false,
        },
        { puuid: "someone-else", championId: 1, championName: "Annie", win: false, kills: 0, deaths: 0, assists: 0, totalMinionsKilled: 0, neutralMinionsKilled: 0 },
      ],
    },
  };
}

const NOW = T("2026-11-12T12:00:00Z");

describe("buildWorkWindows", () => {
  it("one window per started assignment, ended or ongoing", () => {
    const w = buildWorkWindows(
      [
        { id: "a1", status: "RELEASED", startedAt: T("2026-11-01T10:00:00Z"), endedAt: T("2026-11-02T10:00:00Z") },
        { id: "a2", status: "IN_PROGRESS", startedAt: T("2026-11-05T10:00:00Z"), endedAt: null },
      ],
      [],
      NOW
    );
    expect(w).toEqual([
      { start: ms("2026-11-01T10:00:00Z"), end: ms("2026-11-02T10:00:00Z") },
      { start: ms("2026-11-05T10:00:00Z"), end: NOW.getTime() },
    ]);
  });

  it("subtracts paused time and ignores declined / never-started assignments", () => {
    const w = buildWorkWindows(
      [
        { id: "a1", status: "IN_PROGRESS", startedAt: T("2026-11-10T00:00:00Z"), endedAt: null },
        { id: "a0", status: "DECLINED", startedAt: T("2026-11-01T00:00:00Z"), endedAt: T("2026-11-02T00:00:00Z") },
        { id: "a3", status: "ASSIGNED", startedAt: null, endedAt: null },
      ],
      [
        { type: "ORDER_PAUSED", createdAt: T("2026-11-11T00:00:00Z") },
        { type: "ORDER_RESUMED", createdAt: T("2026-11-11T06:00:00Z") },
      ],
      NOW
    );
    expect(w).toEqual([
      { start: ms("2026-11-10T00:00:00Z"), end: ms("2026-11-11T00:00:00Z") },
      { start: ms("2026-11-11T06:00:00Z"), end: NOW.getTime() },
    ]);
  });

  it("an unresolved pause runs until now", () => {
    const w = buildWorkWindows(
      [{ id: "a1", status: "PAUSED", startedAt: T("2026-11-12T00:00:00Z"), endedAt: null }],
      [{ type: "ORDER_PAUSED", createdAt: T("2026-11-12T06:00:00Z") }],
      NOW
    );
    expect(w).toEqual([{ start: ms("2026-11-12T00:00:00Z"), end: ms("2026-11-12T06:00:00Z") }]);
  });
});

describe("attributeMatch", () => {
  const windows = [{ start: ms("2026-11-10T00:00:00Z"), end: ms("2026-11-11T00:00:00Z") }];
  const base = { puuid: PUUID, windows, queueIds: [420] };

  it("attributes a ranked game fully inside a work window", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-10T12:00:00Z" }) })).toEqual({ attributed: true, playedBy: "BOOSTER" });
  });
  it("rejects games before the order started (no unrelated matches)", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-09T12:00:00Z" }) })).toMatchObject({ reason: "outside_window" });
  });
  it("rejects games straddling the window boundary", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-10T23:50:00Z", minutes: 30 }) })).toMatchObject({ reason: "outside_window" });
  });
  it("rejects games of another account", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-10T12:00:00Z", puuid: "other" }) })).toMatchObject({ reason: "not_participant" });
  });
  it("rejects other queues (e.g. ARAM)", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-10T12:00:00Z", queueId: 450 }) })).toMatchObject({ reason: "wrong_queue" });
  });
  it("rejects remakes", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-10T12:00:00Z", minutes: 3, remake: true }) })).toMatchObject({ reason: "remake" });
  });
  it("rejects games without an end timestamp", () => {
    expect(attributeMatch({ ...base, match: match({ start: "2026-11-10T12:00:00Z", ended: false }) })).toMatchObject({ reason: "incomplete" });
  });
  it("attributes nothing when there are no windows (order never worked on)", () => {
    expect(attributeMatch({ ...base, windows: [], match: match({ start: "2026-11-10T12:00:00Z" }) })).toMatchObject({ attributed: false });
  });
});

describe("getOrderQueueIds", () => {
  it("maps services to queues", () => {
    expect(getOrderQueueIds("league-of-legends", "rank-boost", {})).toEqual([420]);
    expect(getOrderQueueIds("league-of-legends", "win-boost", { gameMode: "ranked-flex" })).toEqual([440]);
    expect(getOrderQueueIds("league-of-legends", "unknown", {})).toEqual([]);
    expect(getOrderQueueIds("valorant", "rank-boost", {})).toEqual([]);
  });
});

describe("toOrderMatchRecord", () => {
  it("keeps only the order account's minimal stats", () => {
    const rec = toOrderMatchRecord(match({ id: "EUW1_42", start: "2026-11-10T12:00:00Z" }), PUUID);
    expect(rec).toMatchObject({ matchId: "EUW1_42", championName: "Ahri", kills: 8, deaths: 2, assists: 5, cs: 192, win: true, queueId: 420 });
    expect(JSON.stringify(rec)).not.toContain("someone-else");
  });
});
