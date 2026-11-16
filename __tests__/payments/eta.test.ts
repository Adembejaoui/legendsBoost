import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_MODEL, estimateCompletion, etaLabel } from "@/lib/pricing/eta";

const rank = (from: [string, string], to: [string, string], extra: Record<string, unknown> = {}) => ({
  pricingModel: "RANK_STEPS" as const,
  rankSystemId: "lol-ranked",
  configuration: { currentRank: { tierId: from[0], divisionId: from[1] }, targetRank: { tierId: to[0], divisionId: to[1] }, ...extra },
  selectedMode: "solo",
  selectedOptions: [] as string[],
});

describe("estimated completion time", () => {
  it("sums hours per division by tier", () => {
    // Gold IV -> Gold II: 2 x 2.5 h
    expect(estimateCompletion(DEFAULT_ETA_MODEL, rank(["gold", "iv"], ["gold", "ii"]))).toEqual({ hours: 5, label: "about 5 hours" });
    // Diamond IV -> Master: 4 x 6 h = 24 h = 3 play days
    expect(estimateCompletion(DEFAULT_ETA_MODEL, rank(["diamond", "iv"], ["master", null as unknown as string]))?.label).toBe("about 3-4 days");
  });

  it("low LP gain and duo take longer; priority is faster", () => {
    const base = estimateCompletion(DEFAULT_ETA_MODEL, rank(["silver", "iv"], ["gold", "iv"]))!.hours;
    expect(estimateCompletion(DEFAULT_ETA_MODEL, rank(["silver", "iv"], ["gold", "iv"], { lpGain: "low" }))!.hours).toBeGreaterThan(base);
    expect(estimateCompletion(DEFAULT_ETA_MODEL, { ...rank(["silver", "iv"], ["gold", "iv"]), selectedMode: "duo" })!.hours).toBeGreaterThan(base);
    expect(estimateCompletion(DEFAULT_ETA_MODEL, { ...rank(["silver", "iv"], ["gold", "iv"]), selectedOptions: ["priority-completion"] })!.hours).toBeLessThan(base);
  });

  it("per-unit and fixed services", () => {
    const wins = estimateCompletion(DEFAULT_ETA_MODEL, { pricingModel: "PER_UNIT", configuration: { wins: 5 }, unitFieldKey: "wins", selectedMode: null, selectedOptions: [] });
    expect(wins?.hours).toBe(5);
    const placements = estimateCompletion(DEFAULT_ETA_MODEL, { pricingModel: "PER_UNIT", configuration: { placementsRemaining: 4 }, unitFieldKey: "placementsRemaining", selectedMode: null, selectedOptions: [] });
    expect(placements?.hours).toBe(3);
    expect(estimateCompletion(DEFAULT_ETA_MODEL, { pricingModel: "FIXED", configuration: {}, selectedMode: null, selectedOptions: [] })?.hours).toBe(12);
  });

  it("returns null when the configuration is incomplete", () => {
    expect(estimateCompletion(DEFAULT_ETA_MODEL, { pricingModel: "PER_UNIT", configuration: {}, unitFieldKey: "wins", selectedMode: null, selectedOptions: [] })).toBeNull();
  });

  it("labels hours and day ranges", () => {
    expect(etaLabel(1, 8)).toBe("about 1 hour");
    expect(etaLabel(7.2, 8)).toBe("about 8 hours");
    expect(etaLabel(8, 8)).toBe("about 1-2 days");
    expect(etaLabel(40, 8)).toBe("about 5-7 days");
  });
});
