import { describe, expect, it } from "vitest";
import { compareRanks, nextRank, rankScale, rankValue } from "@/lib/domain/rank";

const r = (tierId: string, divisionId: string | null = null) => ({ tierId, divisionId });

describe("rankValue (LoL)", () => {
  it.each([
    [r("iron", "iv"), 0],
    [r("iron", "i"), 3],
    [r("gold", "i"), 15],
    [r("diamond", "iv"), 24],
    [r("diamond", "i"), 27],
    [r("master"), 28],
  ])("%o = %i", (rank, value) => {
    expect(rankValue("lol-ranked", rank)).toBe(value);
  });

  it("orders divisions IV < III < II < I and has no division on apex tiers", () => {
    expect(rankValue("lol-ranked", r("silver", "iv"))! < rankValue("lol-ranked", r("silver", "iii"))!).toBe(true);
    expect(rankValue("lol-ranked", r("master", "i"))).toBeNull();
    expect(rankValue("lol-ranked", r("diamond"))).toBeNull();
    expect(rankValue("lol-ranked", r("unknown", "iv"))).toBeNull();
  });

  it("values are strictly increasing", () => {
    const values = rankScale("lol-ranked").map((p) => p.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("other games", () => {
  it("VALORANT: Iron 1 = 0, Immortal 3 = 23, Radiant = 24", () => {
    expect(rankValue("valorant-competitive", r("iron", "1"))).toBe(0);
    expect(rankValue("valorant-competitive", r("immortal", "3"))).toBe(23);
    expect(rankValue("valorant-competitive", r("radiant"))).toBe(24);
  });
  it("TFT uses the LoL-style ladder", () => {
    expect(rankValue("tft-ranked", r("master"))).toBe(28);
  });
});

describe("compareRanks / nextRank", () => {
  it("compares and steps up", () => {
    expect(compareRanks("lol-ranked", r("gold", "iv"), r("silver", "i"))).toBeGreaterThan(0);
    expect(nextRank("lol-ranked", r("gold", "i"))).toEqual(r("platinum", "iv"));
    expect(nextRank("lol-ranked", r("diamond", "i"))).toEqual(r("master"));
    expect(nextRank("lol-ranked", r("master"))).toBeNull();
  });
  it("throws on invalid ranks", () => {
    expect(() => compareRanks("lol-ranked", r("x", "iv"), r("gold", "i"))).toThrow();
  });
});
