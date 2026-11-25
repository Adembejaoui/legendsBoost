import { describe, expect, it } from "vitest";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { calculateQuote } from "@/lib/pricing/engine";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { validateServicePriceAgainstCatalog, type ServicePriceConfig, type ServicePriceInput } from "@/lib/pricing/price-config";
import { allMarketPriceInputs, badgeToAdjustment, buildMarketPriceInput, DUO_MODE_BPS } from "@/lib/pricing/market-prices";
import { priceTag } from "@/lib/pricing/price-tags";
import { champions } from "@/lib/catalog/champions";

const POLICY = { id: "pol", platformFeeBps: 2000, boosterShareBps: 8000 };

function asConfig(input: ServicePriceInput): ServicePriceConfig {
  return {
    id: "p",
    version: 1,
    gameSlug: input.gameSlug,
    serviceSlug: input.serviceSlug,
    currency: input.currency,
    pricingModel: input.pricingModel,
    baseAmount: input.baseAmount,
    stepAmounts: input.stepAmounts ?? null,
    unitFieldKey: input.unitFieldKey ?? null,
    unitAmount: input.unitAmount ?? null,
    optionPricing: input.optionPricing,
    modePricing: input.modePricing,
  };
}

function quote(gameSlug: string, serviceSlug: string, configuration: Record<string, unknown>, extra: { selectedMode?: "solo" | "duo"; selectedOptions?: string[] } = {}) {
  const offer = getGameServiceOffer(gameSlug, serviceSlug)!;
  const checkout = getCheckoutConfig(gameSlug, serviceSlug)!;
  const modes = (checkout.modes ?? []).filter((m) => m.enabled).map((m) => m.id);
  const selectedMode = extra.selectedMode ?? (modes.includes("solo") ? "solo" : undefined);
  const v = validateOrderInput(offer, checkout, { gameSlug, serviceSlug, configuration, selectedOptions: [], ...extra, selectedMode });
  if (!v.ok) throw new Error(v.errors.join("; "));
  const r = calculateQuote(offer, checkout, asConfig(buildMarketPriceInput(gameSlug, serviceSlug)!), POLICY, v.value);
  if (!r.ok) throw new Error(r.reason);
  return r.quote;
}

const lol = (cur: [string, string], tgt: [string, string], lp: Record<string, string> = {}) => ({
  currentRank: { tierId: cur[0], divisionId: cur[1] },
  targetRank: { tierId: tgt[0], divisionId: tgt[1] },
  currentLp: "0-20",
  lpGain: "normal",
  ...lp,
});

describe("market default prices", () => {
  it("are valid against the catalog for every priced service", () => {
    const inputs = allMarketPriceInputs();
    expect(inputs.length).toBe(13);
    for (const i of inputs) expect(validateServicePriceAgainstCatalog(i)).toEqual([]);
  });

  it("extras charge the percentage their badge shows; Free/Auto are included; duo is +50%", () => {
    expect(badgeToAdjustment("+25%")).toEqual({ type: "bps", bps: 2500 });
    expect(badgeToAdjustment("Free")).toEqual({ type: "fixed", amount: 0 });
    expect(badgeToAdjustment("Auto")).toEqual({ type: "fixed", amount: 0 });
    expect(badgeToAdjustment("+7.5%")).toEqual({ type: "bps", bps: 750 });
    const lolRank = buildMarketPriceInput("league-of-legends", "rank-boost")!;
    expect(lolRank.optionPricing["priority-completion"]).toEqual({ type: "bps", bps: 2500 });
    // Matched to gameboost.com (2026-11-25).
    expect(lolRank.optionPricing["stream-games"]).toEqual({ type: "bps", bps: 1500 });
    expect(lolRank.optionPricing["solo-only-queue"]).toEqual({ type: "bps", bps: 2000 });
    expect(lolRank.optionPricing["bonus-win"]).toEqual({ type: "bps", bps: 750 });
    expect(lolRank.optionPricing["hidden-duo"]).toEqual({ type: "bps", bps: 2500 });
    expect(lolRank.optionPricing.vpn).toEqual({ type: "fixed", amount: 0 });
    expect(lolRank.modePricing.duo).toEqual({ type: "bps", bps: DUO_MODE_BPS });
    expect(DUO_MODE_BPS).toBe(5000);
  });
});

describe("rank boost pricing", () => {
  it("costs more for longer and higher boosts", () => {
    const silverOne = quote("league-of-legends", "rank-boost", lol(["silver", "iv"], ["silver", "iii"]));
    expect(silverOne.totalAmount).toBe(758);
    const silverToGold = quote("league-of-legends", "rank-boost", lol(["silver", "iv"], ["gold", "iv"]));
    expect(silverToGold.totalAmount).toBe(4 * 758);
    const diamond = quote("league-of-legends", "rank-boost", lol(["diamond", "iv"], ["diamond", "iii"]));
    expect(diamond.totalAmount).toBeGreaterThan(silverOne.totalAmount * 4);
  });

  it("current LP discounts the first division only", () => {
    const q = quote("league-of-legends", "rank-boost", lol(["silver", "iv"], ["silver", "ii"], { currentLp: "61-80" }));
    // 2 x 7.58, minus 45% of the first step (3.41)
    expect(q.lines.find((l) => l.code === "LP:CURRENT")?.amount).toBe(-341);
    expect(q.totalAmount).toBe(1516 - 341);
  });

  it("low LP gain adds 30%, high LP gain removes 10%", () => {
    const low = quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "ii"], { lpGain: "low" }));
    expect(low.totalAmount).toBe(2186 + 656);
    const high = quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "ii"], { lpGain: "high" }));
    expect(high.totalAmount).toBe(2186 - 219);
  });

  it("extras and duo apply to the LP-adjusted price", () => {
    const q = quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "iii"], { lpGain: "low" }), {
      selectedMode: "duo",
      selectedOptions: ["priority-completion"],
    });
    const service = 1093 + 328;
    expect(q.totalAmount).toBe(service + Math.round(service * 0.5) + Math.round(service * 0.25));
    // Every extra of the mode is priced on the service amount (shown before it is switched on).
    expect(q.optionAmounts["voice-chat"]).toBe(Math.round(service * 0.2));
    expect(q.optionAmounts["solo-only-queue"]).toBeUndefined(); // Solo only
    expect(q.commission.platformFeeAmount + q.commission.boosterShareAmount).toBe(q.totalAmount);
  });

  it("VALORANT uses RR and its own tiers", () => {
    const q = quote("valorant", "rank-boost", lol(["immortal", "1"], ["immortal", "2"]));
    expect(q.totalAmount).toBe(6000);
  });

  it("rejects an unknown LP bracket (server-side validation)", () => {
    expect(() => quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "iii"], { currentLp: "999" }))).toThrow();
  });
});

describe("per-unit services", () => {
  it("win boost is priced per win, by the current rank tier", () => {
    const wins = (tierId: string, divisionId: string | null) => quote("league-of-legends", "win-boost", { currentRank: { tierId, divisionId }, wins: 3 }).totalAmount;
    expect(wins("gold", "iv")).toBe(3 * 387);
    expect(wins("iron", "i")).toBe(3 * 115);
    expect(wins("master", null)).toBe(3 * 2554);
    expect(quote("valorant", "win-boost", { currentRank: { tierId: "gold", divisionId: "3" }, wins: 3 }).totalAmount).toBe(3 * 516);
  });
  it("champion mastery adds the price of each level (4 -> 6 = 41.20 + 19.69)", () => {
    expect(quote("league-of-legends", "champion-mastery", { champion: champions.find((c) => c.name === "Jinx")!.id, server: "EUW1", currentLevel: 4, targetLevel: 6 }).totalAmount).toBe(4120 + 1969);
  });
  it("normal games: per game, wins +50%", () => {
    expect(quote("league-of-legends", "normal-matches", { matches: 5 }).totalAmount).toBe(5 * 272);
    expect(quote("league-of-legends", "normal-matches", { matches: 5, countType: "wins" }).totalAmount).toBe(5 * 272 + 680);
  });
  it("placements are priced per match", () => {
    expect(quote("league-of-legends", "placement-boost", { placementsRemaining: 5, currentRank: { tierId: "gold", divisionId: "iv" } }).totalAmount).toBe(5 * 210);
  });
});

describe("price tags (badges)", () => {
  it("show what the server charges", () => {
    expect(priceTag({ type: "bps", bps: 2500 }, "USD")).toBe("+25%");
    expect(priceTag({ type: "bps", bps: 1250 }, "USD")).toBe("+12.5%");
    expect(priceTag({ type: "fixed", amount: 0 }, "USD")).toBe("Free");
    expect(priceTag({ type: "fixed", amount: 500 }, "USD")).toBe("+$5.00");
  });
});

describe("per-rank unit prices (2026-11-25)", () => {
  it("reject unknown tiers or levels and services without a rank or level", () => {
    const win = buildMarketPriceInput("league-of-legends", "win-boost")!;
    expect(validateServicePriceAgainstCatalog({ ...win, stepAmounts: { gold: 100, wood: 50 } })).toContain("Unknown unit step: wood");
    const normal = buildMarketPriceInput("league-of-legends", "normal-matches")!;
    expect(validateServicePriceAgainstCatalog({ ...normal, stepAmounts: { gold: 100 } })).toContain("This service has no per-rank or per-level unit prices.");
    const mastery = buildMarketPriceInput("league-of-legends", "champion-mastery")!;
    expect(validateServicePriceAgainstCatalog({ ...mastery, stepAmounts: { "10": 100 } })).toContain("Unknown unit step: 10");
  });
});
