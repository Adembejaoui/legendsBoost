import { describe, expect, it } from "vitest";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { calculateQuote } from "@/lib/pricing/engine";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { validateServicePriceAgainstCatalog, type ServicePriceConfig, type ServicePriceInput } from "@/lib/pricing/price-config";
import { allMarketPriceInputs, badgeToAdjustment, buildMarketPriceInput, DUO_MODE_BPS } from "@/lib/pricing/market-prices";
import { priceTag } from "@/lib/pricing/price-tags";

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
    expect(inputs.length).toBe(12);
    for (const i of inputs) expect(validateServicePriceAgainstCatalog(i)).toEqual([]);
  });

  it("extras charge the percentage their badge shows; Free/Auto are included; duo is +50%", () => {
    expect(badgeToAdjustment("+25%")).toEqual({ type: "bps", bps: 2500 });
    expect(badgeToAdjustment("Free")).toEqual({ type: "fixed", amount: 0 });
    expect(badgeToAdjustment("Auto")).toEqual({ type: "fixed", amount: 0 });
    expect(badgeToAdjustment("+7.5%")).toEqual({ type: "bps", bps: 750 });
    const lolRank = buildMarketPriceInput("league-of-legends", "rank-boost")!;
    expect(lolRank.optionPricing["priority-completion"]).toEqual({ type: "bps", bps: 2500 });
    // Client PDFs 2026-11-19.
    expect(lolRank.optionPricing["stream-games"]).toEqual({ type: "bps", bps: 2000 });
    expect(lolRank.optionPricing["solo-only-queue"]).toEqual({ type: "bps", bps: 3000 });
    expect(lolRank.optionPricing["bonus-win"]).toEqual({ type: "bps", bps: 750 });
    expect(lolRank.optionPricing["hidden-duo"]).toEqual({ type: "bps", bps: 5000 });
    expect(lolRank.optionPricing.vpn).toEqual({ type: "fixed", amount: 0 });
    expect(lolRank.modePricing.duo).toEqual({ type: "bps", bps: DUO_MODE_BPS });
    expect(DUO_MODE_BPS).toBe(5000);
  });
});

describe("rank boost pricing", () => {
  it("costs more for longer and higher boosts", () => {
    const silverOne = quote("league-of-legends", "rank-boost", lol(["silver", "iv"], ["silver", "iii"]));
    expect(silverOne.totalAmount).toBe(900);
    const silverToGold = quote("league-of-legends", "rank-boost", lol(["silver", "iv"], ["gold", "iv"]));
    expect(silverToGold.totalAmount).toBe(4 * 900);
    const diamond = quote("league-of-legends", "rank-boost", lol(["diamond", "iv"], ["diamond", "iii"]));
    expect(diamond.totalAmount).toBeGreaterThan(silverOne.totalAmount * 4);
  });

  it("current LP discounts the first division only", () => {
    const q = quote("league-of-legends", "rank-boost", lol(["silver", "iv"], ["silver", "ii"], { currentLp: "61-80" }));
    // 2 x 9.00, minus 45% of the first step (4.05)
    expect(q.lines.find((l) => l.code === "LP:CURRENT")?.amount).toBe(-405);
    expect(q.totalAmount).toBe(1800 - 405);
  });

  it("low LP gain adds 30%, high LP gain removes 10%", () => {
    const low = quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "ii"], { lpGain: "low" }));
    expect(low.totalAmount).toBe(2400 + 720);
    const high = quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "ii"], { lpGain: "high" }));
    expect(high.totalAmount).toBe(2400 - 240);
  });

  it("extras and duo apply to the LP-adjusted price", () => {
    const q = quote("league-of-legends", "rank-boost", lol(["gold", "iv"], ["gold", "iii"], { lpGain: "low" }), {
      selectedMode: "duo",
      selectedOptions: ["priority-completion"],
    });
    const service = 1200 + 360;
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
  it("win boost is priced per win", () => {
    expect(quote("league-of-legends", "win-boost", { currentRank: { tierId: "gold", divisionId: "iv" }, wins: 3 }).totalAmount).toBe(3 * 450);
  });
  it("placements are priced per match", () => {
    expect(quote("league-of-legends", "placement-boost", { placementsRemaining: 5, currentRank: { tierId: "gold", divisionId: "iv" } }).totalAmount).toBe(5 * 400);
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
