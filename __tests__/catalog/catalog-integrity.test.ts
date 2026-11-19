/**
 * Structural integrity of the REAL catalog (no mocks): every service is
 * internally consistent and can be priced through the admin workflow.
 * Catches duplicate option keys, inverted division order, orphan configs and
 * services the admin form could never make purchasable.
 */
import { champions } from "@/lib/catalog/champions";
import { describe, it, expect } from "vitest";
import { games } from "@/lib/catalog/games";
import { gameServices } from "@/lib/catalog/game-services";
import { checkoutConfigs, getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem, isTargetAboveCurrent, rankScore, rankSystems } from "@/lib/catalog/rank-systems";
import { rankLadder } from "@/lib/pricing/engine";
import { validateServicePriceAgainstCatalog, servicePriceInputSchema } from "@/lib/pricing/price-config";
import { evaluateOrderEligibility } from "@/lib/orders/order-eligibility";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { enabledModes, enabledOptionsFor, fixturePriceInput, validConfiguration } from "../support/catalog-fixtures";

const services = gameServices.map((o) => [`${o.gameSlug}:${o.serviceSlug}`, o] as const);

describe("catalog coverage", () => {
  it("covers League of Legends, Teamfight Tactics and VALORANT (14 services)", () => {
    expect(games.map((g) => g.slug).sort()).toEqual(["league-of-legends", "teamfight-tactics", "valorant"]);
    expect(gameServices).toHaveLength(14);
  });

  it("every game's serviceSlugs match its catalog offers, and every offer has exactly one checkout config", () => {
    for (const g of games) {
      expect(gameServices.filter((o) => o.gameSlug === g.slug).map((o) => o.serviceSlug).sort()).toEqual([...g.serviceSlugs].sort());
    }
    for (const o of gameServices) {
      expect(checkoutConfigs.filter((c) => c.gameSlug === o.gameSlug && c.serviceSlug === o.serviceSlug)).toHaveLength(1);
    }
    expect(checkoutConfigs).toHaveLength(gameServices.length);
  });
});

describe.each(services)("%s", (_key, offer) => {
  const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug)!;

  it("has unique option ids (the server and the admin form key options by id)", () => {
    const ids = checkout.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only offers options in modes the service has", () => {
    const modes = new Set(enabledModes(checkout));
    for (const o of checkout.options) {
      if (modes.size === 0) expect(o.availableModes ?? []).toEqual(expect.any(Array));
      else for (const m of o.availableModes ?? []) expect(modes.has(m)).toBe(true);
    }
  });

  it("references existing rank systems of the same game", () => {
    for (const f of offer.fields) {
      if (f.type !== "rank-picker") continue;
      const system = getRankSystem(f.rankSystemId);
      expect(system, f.rankSystemId).toBeDefined();
      expect(system!.gameSlug).toBe(offer.gameSlug);
    }
    if (offer.rankSystemId) expect(getRankSystem(offer.rankSystemId)?.gameSlug).toBe(offer.gameSlug);
  });

  it("offer and checkout sellability flags agree (no half-published service)", () => {
    expect(checkout.availability).toBe(offer.availability);
    expect(checkout.orderCapability).toBe(offer.orderCapability);
    expect(checkout.complianceStatus).toBe(offer.complianceStatus);
    const published = offer.availability === "available" && offer.orderCapability === "live-order";
    expect(checkout.allowOrder === true).toBe(published);
    // Real (live-key) sales also need compliance approval ...
    expect(evaluateOrderEligibility(offer, checkout, "live").ok).toBe(published && offer.complianceStatus === "approved");
    // ... test-key purchases only need publication and no rejection.
    expect(evaluateOrderEligibility(offer, checkout, "test").ok).toBe(published && offer.complianceStatus !== "rejected");
  });

  it("can be fully priced through the admin workflow (every tier, mode and enabled option)", () => {
    const tiers = offer.rankSystemId ? (getRankSystem(offer.rankSystemId)?.tiers ?? []).map((t) => t.id) : [];
    const parsed = servicePriceInputSchema.parse(fixturePriceInput(offer, checkout, tiers));
    expect(validateServicePriceAgainstCatalog(parsed)).toEqual([]);
  });

  it("accepts a valid configuration with every enabled option of each mode", () => {
    const modes = enabledModes(checkout);
    for (const mode of modes.length ? modes : [null]) {
      const { configuration } = validConfiguration(offer);
      const r = validateOrderInput(offer, checkout, {
        gameSlug: offer.gameSlug,
        serviceSlug: offer.serviceSlug,
        configuration,
        selectedMode: mode ?? undefined,
        selectedOptions: enabledOptionsFor(checkout, mode),
        // OTP Champ Only needs its champion.
        ...(enabledOptionsFor(checkout, mode).includes("otp-champion")
          ? { championsRoles: { roles: [], champions: [], otpChampion: champions.find((c) => c.name === "Jinx")!.id } }
          : {}),
      });
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    }
  });
});

describe("rank progression", () => {
  it.each(rankSystems.map((s) => [s.id, s] as const))("%s: tiers ascend and every ladder step scores strictly higher", (_id, system) => {
    const orders = system.tiers.map((t) => t.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    const ladder = rankLadder(system.id);
    for (let i = 1; i < ladder.length; i++) {
      expect(rankScore(system.id, ladder[i])!).toBeGreaterThan(rankScore(system.id, ladder[i - 1])!);
      expect(isTargetAboveCurrent(system.id, ladder[i - 1], ladder[i])).toBe(true);
      expect(isTargetAboveCurrent(system.id, ladder[i], ladder[i - 1])).toBe(false);
    }
  });

  it("VALORANT: division 1 is the lowest and 3 the highest (Iron 1 < Iron 3 < Bronze 1)", () => {
    const id = "valorant-competitive";
    expect(isTargetAboveCurrent(id, { tierId: "iron", divisionId: "1" }, { tierId: "iron", divisionId: "3" })).toBe(true);
    expect(isTargetAboveCurrent(id, { tierId: "iron", divisionId: "3" }, { tierId: "iron", divisionId: "1" })).toBe(false);
    expect(isTargetAboveCurrent(id, { tierId: "iron", divisionId: "3" }, { tierId: "bronze", divisionId: "1" })).toBe(true);
    const ladder = rankLadder(id);
    expect(ladder[0]).toEqual({ tierId: "iron", divisionId: "1" });
    expect(ladder.at(-1)).toEqual({ tierId: "radiant", divisionId: null });
    expect(ladder).toHaveLength(8 * 3 + 1);
  });

  it.each(["lol-ranked", "tft-ranked", "tft-double-up"])("%s: IV is the lowest and I the highest division; Master is the apex", (id) => {
    expect(isTargetAboveCurrent(id, { tierId: "gold", divisionId: "iv" }, { tierId: "gold", divisionId: "i" })).toBe(true);
    expect(isTargetAboveCurrent(id, { tierId: "gold", divisionId: "i" }, { tierId: "platinum", divisionId: "iv" })).toBe(true);
    const ladder = rankLadder(id);
    expect(ladder[0]).toEqual({ tierId: "iron", divisionId: "iv" });
    expect(ladder.at(-1)).toEqual({ tierId: "master", divisionId: null });
    expect(ladder).toHaveLength(7 * 4 + 1);
  });
});
