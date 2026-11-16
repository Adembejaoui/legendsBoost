import { describe, it, expect } from "vitest";
import * as progression from "@/lib/services/games/league-of-legends/progression.service";
import {
  APEX_BASE_SCORE,
  computeRankProgress,
  computeWinProgress,
  formatRank,
  normalizeRank,
  rankToScore,
} from "@/lib/services/games/league-of-legends/progression.service";
import type { LeagueRank, SourcedRank } from "@/lib/services/games/league-of-legends/riot.types";

const NOW = new Date("2026-11-12T12:00:00Z");
const r = (tier: string, division: string | null, lp = 0): LeagueRank => normalizeRank(tier, division, lp)!;
const s = (
  tier: string,
  division: string | null,
  lp = 0,
  source: SourcedRank["source"] = "riot",
  at: Date | null = NOW
): SourcedRank => ({ ...r(tier, division, lp), source, at });

describe("normalizeRank", () => {
  it("accepts Riot and catalog casing", () => {
    expect(normalizeRank("DIAMOND", "IV", 35)).toEqual({ tier: "DIAMOND", division: "IV", lp: 35 });
    expect(normalizeRank("diamond", "iv")).toEqual({ tier: "DIAMOND", division: "IV", lp: 0 });
  });
  it("apex tiers have no division", () => {
    expect(normalizeRank("master", "i", 120)).toEqual({ tier: "MASTER", division: null, lp: 120 });
  });
  it("rejects unknown tiers / missing divisions", () => {
    expect(normalizeRank("WOOD", "I")).toBeNull();
    expect(normalizeRank("GOLD", null)).toBeNull();
    expect(normalizeRank("GOLD", "V")).toBeNull();
    expect(normalizeRank(undefined, "I")).toBeNull();
  });
  it("clamps LP for divisioned tiers and floors negatives", () => {
    expect(normalizeRank("GOLD", "I", 150)!.lp).toBe(100);
    expect(normalizeRank("GOLD", "I", -20)!.lp).toBe(0);
  });
});

describe("rankToScore", () => {
  it("orders divisions, tiers and LP correctly", () => {
    expect(rankToScore(r("IRON", "IV", 0))).toBe(0);
    expect(rankToScore(r("IRON", "III", 0))).toBe(100);
    expect(rankToScore(r("BRONZE", "IV", 0))).toBe(400);
    expect(rankToScore(r("DIAMOND", "I", 99))).toBe(2799);
    expect(rankToScore(r("MASTER", null, 0))).toBe(APEX_BASE_SCORE);
    expect(rankToScore(r("GRANDMASTER", null, 500))).toBe(APEX_BASE_SCORE + 500);
  });
});

describe("computeRankProgress", () => {
  it("same division, LP gain", () => {
    const p = computeRankProgress({ start: s("GOLD", "II", 20), current: s("GOLD", "II", 70), target: r("GOLD", "I"), now: NOW });
    expect(p.status).toBe("in_progress");
    expect(p.lpDelta).toBe(50);
    expect(p.lpRemaining).toBe(30);
    expect(p.percent).toBe(62); // 50 / 80
    expect(p.stepsDelta).toBe(0);
  });

  it("division progression", () => {
    const p = computeRankProgress({ start: s("SILVER", "IV", 0), current: s("SILVER", "II", 0), target: r("GOLD", "IV"), now: NOW });
    expect(p.percent).toBe(50);
    expect(p.stepsDelta).toBe(2);
  });

  it("tier progression (promotion across tiers)", () => {
    const p = computeRankProgress({ start: s("PLATINUM", "I", 50), current: s("EMERALD", "IV", 10), target: r("EMERALD", "II"), now: NOW });
    expect(p.status).toBe("in_progress");
    expect(p.lpDelta).toBe(60);
    expect(p.direction).toBe("up");
    expect(p.stepsDelta).toBe(1);
  });

  it("reaching the target is complete at 100%", () => {
    const p = computeRankProgress({ start: s("GOLD", "IV"), current: s("GOLD", "II", 5), target: r("GOLD", "II"), now: NOW });
    expect(p.status).toBe("complete");
    expect(p.percent).toBe(100);
  });

  it("never shows 100% before the target is actually reached", () => {
    const p = computeRankProgress({ start: s("GOLD", "IV"), current: s("GOLD", "III", 99), target: r("GOLD", "II"), now: NOW });
    expect(p.status).toBe("in_progress");
    expect(p.percent).toBeLessThan(100);
  });

  it("demotion below the start clamps percent at 0 and flags it", () => {
    const p = computeRankProgress({ start: s("DIAMOND", "IV", 35), current: s("EMERALD", "I", 80), target: r("MASTER", null), now: NOW });
    expect(p.demoted).toBe(true);
    expect(p.direction).toBe("down");
    expect(p.lpDelta).toBe(-55);
    expect(p.percent).toBe(0);
    expect(p.stepsDelta).toBe(-1);
  });

  it("LP loss within a division is a negative delta", () => {
    const p = computeRankProgress({ start: s("GOLD", "II", 50), current: s("GOLD", "II", 30), target: r("GOLD", "I"), now: NOW });
    expect(p.lpDelta).toBe(-20);
    expect(p.percent).toBe(0);
  });

  it("Diamond IV 35 LP -> Master (apex target without divisions)", () => {
    const p = computeRankProgress({ start: s("DIAMOND", "IV", 35), current: s("DIAMOND", "II", 35), target: r("MASTER", null), now: NOW });
    expect(p.status).toBe("in_progress");
    // start 2435, current 2635, target 2800 -> 200/365
    expect(p.percent).toBe(54);
    expect(p.lpRemaining).toBe(165);
  });

  it("Master target reached once Master is observed", () => {
    const p = computeRankProgress({ start: s("DIAMOND", "I", 0), current: s("MASTER", null, 12), target: r("MASTER", null), now: NOW });
    expect(p.status).toBe("complete");
  });

  it("Grandmaster/Challenger targets are indeterminate, not a made-up percent", () => {
    const p = computeRankProgress({ start: s("MASTER", null, 50), current: s("MASTER", null, 300), target: r("GRANDMASTER", null), now: NOW });
    expect(p.status).toBe("indeterminate");
    expect(p.percent).toBeNull();
    expect(p.lpDelta).toBe(250);
  });

  it("Grandmaster target completes only when the tier itself is reported", () => {
    const p = computeRankProgress({ start: s("MASTER", null, 50), current: s("GRANDMASTER", null, 420), target: r("GRANDMASTER", null), now: NOW });
    expect(p.status).toBe("complete");
    const c = computeRankProgress({ start: s("MASTER", null, 0), current: s("GRANDMASTER", null, 600), target: r("CHALLENGER", null), now: NOW });
    expect(c.status).toBe("indeterminate");
  });

  it("target not above start is invalid", () => {
    const p = computeRankProgress({ start: s("GOLD", "I"), current: s("GOLD", "I"), target: r("GOLD", "II"), now: NOW });
    expect(p.status).toBe("invalid");
    expect(p.percent).toBeNull();
  });

  it("missing current rank (unavailable Riot data) shows no percentage", () => {
    const p = computeRankProgress({ start: s("GOLD", "IV"), current: null, target: r("GOLD", "I"), now: NOW });
    expect(p.status).toBe("unavailable");
    expect(p.percent).toBeNull();
  });

  it("stale Riot data is flagged", () => {
    const old = new Date(NOW.getTime() - 25 * 3600 * 1000);
    const p = computeRankProgress({ start: s("GOLD", "IV"), current: s("GOLD", "III", 0, "riot", old), target: r("GOLD", "I"), now: NOW });
    expect(p.stale).toBe(true);
  });

  it("flags an assumed start LP", () => {
    const start = { ...s("GOLD", "IV", 0, "order"), lpAssumed: true };
    const p = computeRankProgress({ start, current: s("GOLD", "III"), target: r("GOLD", "I"), now: NOW });
    expect(p.startLpAssumed).toBe(true);
  });
});

describe("current rank source (manual rank reporting removed)", () => {
  it("there is no report-vs-Riot selection any more: the current rank is Riot data only", () => {
    expect((progression as Record<string, unknown>).selectCurrentRank).toBeUndefined();
  });
  it("progress never carries a manual-report flag", () => {
    const p = computeRankProgress({ start: s("GOLD", "IV"), current: s("GOLD", "II"), target: r("PLATINUM", "IV"), now: NOW });
    expect(p).not.toHaveProperty("unconfirmed");
  });
});

describe("misc", () => {
  it("formatRank", () => {
    expect(formatRank(r("DIAMOND", "IV", 35))).toBe("Diamond IV · 35 LP");
    expect(formatRank(r("MASTER", null, 0), false)).toBe("Master");
  });
  it("computeWinProgress", () => {
    expect(computeWinProgress(3, 5)).toEqual({ percent: 60, remaining: 2 });
    expect(computeWinProgress(7, 5)).toEqual({ percent: 100, remaining: 0 });
    expect(computeWinProgress(1, null)).toEqual({ percent: null, remaining: null });
  });
});
