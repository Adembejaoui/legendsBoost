// @vitest-environment node
/**
 * League pages follow the client PDFs (2026-11-19): extras per mode with
 * their prices, Server / Queue Type fields, 1-5 wins, OTP champion,
 * Arena (1-3 wins) and Champion Mastery (Level 1-10, price per level).
 */
import { describe, it, expect } from "vitest";
import { getCheckoutConfig, getCheckoutOptionsForMode } from "@/lib/config/checkout-options";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { buildMarketPriceInput } from "@/lib/pricing/market-prices";
import { champions } from "@/lib/catalog/champions";

const JINX = champions.find((c) => c.name === "Jinx")!.id;

const lol = (service: string) => getCheckoutConfig("league-of-legends", service)!;
const labels = (service: string, mode: "solo" | "duo") =>
  getCheckoutOptionsForMode(lol(service), mode).map((o) => `${o.label} ${o.badge}`);

describe("Rank Boost extras", () => {
  it("Solo: the 10 extras of the PDF, with their prices", () => {
    expect(labels("rank-boost", "solo").sort()).toEqual(
      [
        "Solo Queue Only +30%", "+1 Bonus Win +7.5%", "Priority Order +25%", "Live Streaming +20%",
        "Specific Champion and Role Free", "VPN Free", "Appear Offline Free",
        "Undercover Winrate +25%", "Moderate KDA +25%", "OTP Champ Only +35%",
      ].sort()
    );
  });
  it("Duo: the 6 extras of the PDF; Duo hover texts where they differ", () => {
    expect(labels("rank-boost", "duo").sort()).toEqual(
      ["+1 Bonus Win +7.5%", "Priority Order +25%", "Voice Chat +20%", "Undercover Winrate +25%", "Moderate KDA +25%", "Hidden Duo +50%"].sort()
    );
    const bonus = getCheckoutOptionsForMode(lol("rank-boost"), "duo").find((o) => o.id === "bonus-win")!;
    expect(bonus.descriptionDuo).toMatch(/play with your booster/);
    expect(lol("rank-boost").modes?.map((m) => m.label)).toEqual(["Solo (pro on your account)", "Duo (play with a pro)"]);
  });
  it("every extra has hover text and a booster rule; ids are unique", () => {
    const opts = lol("rank-boost").options;
    expect(new Set(opts.map((o) => o.id)).size).toBe(opts.length);
    for (const o of opts) {
      expect(o.description, o.id).toBeTruthy();
      expect(o.boosterRule, o.id).toBeTruthy();
    }
  });
  it("Server and Queue Type are on the form", () => {
    const keys = getGameServiceOffer("league-of-legends", "rank-boost")!.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["currentLp", "lpGain", "server", "queueType"]));
  });
});

describe("Net Wins and Placements extras", () => {
  it.each(["win-boost", "placement-boost"])("%s: 8 Solo / 4 Duo extras", (service) => {
    expect(labels(service, "solo")).toEqual([
      "Priority Order +25%", "Solo Queue Only +30%", "Live Streaming +20%", "VPN Free",
      "Specific Champion and Role Free", "Appear Offline Free", "Moderate KDA +25%", "OTP Champ Only +35%",
    ]);
    expect(labels(service, "duo")).toEqual(["Priority Order +25%", "Voice Chat +20%", "Moderate KDA +25%", "Hidden Duo +50%"]);
  });
  it("Net Wins and Placements go up to 5 games with a slider; Placements needs its rank, has Queue Type and Server, no Current LP", () => {
    const field = (service: string, key: string) =>
      getGameServiceOffer("league-of-legends", service)!.fields.find((f) => f.key === key) as { min?: number; max?: number; display?: string };
    expect(field("win-boost", "wins")).toMatchObject({ min: 1, max: 5, display: "slider" });
    expect(field("placement-boost", "placementsRemaining")).toMatchObject({ max: 5, display: "slider" });
    const keys = getGameServiceOffer("league-of-legends", "placement-boost")!.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["currentRank", "queueType", "server"]));
    expect(keys).not.toContain("currentLp");
    expect(getGameServiceOffer("league-of-legends", "placement-boost")!.fields.find((f) => f.key === "currentRank")?.required).toBe(true);
  });
  it("Placements can now be bought in Duo (+50%)", () => {
    expect(lol("placement-boost").modes?.map((m) => m.id)).toEqual(["solo", "duo"]);
    expect(buildMarketPriceInput("league-of-legends", "placement-boost")!.modePricing.duo).toEqual({ type: "bps", bps: 5000 });
  });
});

describe("order input", () => {
  const offer = getGameServiceOffer("league-of-legends", "win-boost")!;
  const base = {
    gameSlug: "league-of-legends",
    serviceSlug: "win-boost",
    configuration: { currentRank: { tierId: "silver", divisionId: "i" }, wins: 2, server: "EUW1" },
    selectedMode: "solo" as const,
  };
  it("OTP Champ Only needs one real champion", () => {
    const missing = validateOrderInput(offer, lol("win-boost"), { ...base, selectedOptions: ["otp-champion"] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors).toContain("Choose the champion for OTP Champ Only.");
    const fake = validateOrderInput(offer, lol("win-boost"), {
      ...base,
      selectedOptions: ["otp-champion"],
      championsRoles: { roles: [], champions: [], otpChampion: "NotAChampion" },
    });
    expect(fake.ok).toBe(false);
    const ok = validateOrderInput(offer, lol("win-boost"), {
      ...base,
      selectedOptions: ["otp-champion"],
      championsRoles: { roles: [], champions: [], otpChampion: JINX },
    });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    if (ok.ok) expect(ok.value.championsRoles?.otpChampion).toBeTruthy();
  });
  it("more than 5 wins and an unknown server are refused", () => {
    expect(validateOrderInput(offer, lol("win-boost"), { ...base, configuration: { ...base.configuration, wins: 5 }, selectedOptions: [] }).ok).toBe(true);
    expect(validateOrderInput(offer, lol("win-boost"), { ...base, configuration: { ...base.configuration, wins: 6 }, selectedOptions: [] }).ok).toBe(false);
    expect(validateOrderInput(offer, lol("win-boost"), { ...base, configuration: { ...base.configuration, server: "MOON1" }, selectedOptions: [] }).ok).toBe(false);
  });
});

describe("Arena", () => {
  const offer = getGameServiceOffer("league-of-legends", "arena-boost")!;
  const base = {
    gameSlug: "league-of-legends",
    serviceSlug: "arena-boost",
    configuration: { currentRank: { tierId: "gold" }, arenaWins: 3, server: "EUW1" },
    selectedMode: "solo" as const,
    selectedOptions: [],
  };
  it("uses the Arena ranks with their icons and 1 to 5 wins (client 2026-11-24)", () => {
    const rank = offer.fields.find((f) => f.key === "currentRank") as { rankSystemId?: string };
    expect(rank.rankSystemId).toBe("lol-arena");
    expect(validateOrderInput(offer, lol("arena-boost"), base).ok).toBe(true);
    expect(validateOrderInput(offer, lol("arena-boost"), { ...base, configuration: { ...base.configuration, arenaWins: 5 } }).ok).toBe(true);
    expect(validateOrderInput(offer, lol("arena-boost"), { ...base, configuration: { ...base.configuration, arenaWins: 6 } }).ok).toBe(false);
  });
  it("is counted in Arena wins (1st place) on order cards and progress", async () => {
    const { orderGameCount, countLabel, GAME_COUNT_TEXT } = await import("@/lib/orders/game-count");
    const g = orderGameCount("league-of-legends", "arena-boost", base.configuration)!;
    expect(g).toMatchObject({ kind: "arena-wins", fieldKey: "arenaWins", total: 3, unit: "Arena wins", caption: "Arena wins ordered" });
    expect(countLabel(1, g.unit)).toBe("1 Arena win");
    expect(GAME_COUNT_TEXT["arena-wins"].howToCount).toMatch(/1st place/);
    expect(orderGameCount("league-of-legends", "arena-boost", { arenaWins: 0 })).toBeNull();
  });
  it("Solo and Duo extras of the PDF", () => {
    expect(lol("arena-boost").modes?.map((m) => m.id)).toEqual(["solo", "duo"]);
    expect(labels("arena-boost", "duo")).toEqual(expect.arrayContaining(["Your Champions and Roles +10%", "Hidden Duo +25%"]));
  });
});

describe("Champion Mastery", () => {
  const offer = getGameServiceOffer("league-of-legends", "champion-mastery")!;
  const base = {
    gameSlug: "league-of-legends",
    serviceSlug: "champion-mastery",
    configuration: { champion: JINX, currentLevel: 4, targetLevel: 6, server: "EUW1" },
    selectedMode: "solo" as const,
    selectedOptions: [],
  };
  it("levels go from 1 to 10 and the desired level must be higher", () => {
    expect(validateOrderInput(offer, lol("champion-mastery"), base).ok).toBe(true);
    expect(validateOrderInput(offer, lol("champion-mastery"), { ...base, configuration: { ...base.configuration, targetLevel: 11 } }).ok).toBe(false);
  });
  it("is priced per level gained and is Solo only", () => {
    expect(buildMarketPriceInput("league-of-legends", "champion-mastery")).toMatchObject({
      pricingModel: "PER_UNIT",
      unitFieldKey: "range:currentLevel:targetLevel",
      unitAmount: 600,
    });
    expect(labels("champion-mastery", "solo")).toEqual(["Priority Order +25%", "Stream Games +15%", "Appear Offline Free"]);
  });
});
