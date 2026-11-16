// @vitest-environment node
/**
 * Steps 1-2 data: "From $X" starting prices come from the real pricing
 * engine on the cheapest valid configuration (using the applied temporary
 * prices), and the sign-in return path cannot be used as an open redirect.
 */
import { describe, it, expect } from "vitest";
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { computeStartingPrice } from "@/lib/catalog/storefront";
import { buildTemporaryPriceInput } from "@/lib/pricing/temporary-prices";
import type { ServicePriceConfig } from "@/lib/pricing/price-config";
import { safeCallbackPath } from "@/lib/auth/safe-callback";

const POLICY = { id: "p", platformFeeBps: 4500, boosterShareBps: 5500 };
const EXPECTED_FROM: Record<string, number> = {
  "league-of-legends:rank-boost": 1000,
  "league-of-legends:win-boost": 300,
  "league-of-legends:placement-boost": 800,
  "league-of-legends:champion-mastery": 500,
  "valorant:rank-boost": 1000,
  "valorant:win-boost": 300,
  "valorant:placement-boost": 800,
  "teamfight-tactics:rank-boost": 1000,
  "teamfight-tactics:win-boost": 300,
  "teamfight-tactics:placement-boost": 800,
  "teamfight-tactics:double-up-boost": 1000,
};

describe("starting prices (step 2 badges)", () => {
  it.each(Object.entries(EXPECTED_FROM))("%s starts at %i cents", (key, cents) => {
    const [g, s] = key.split(":");
    const offer = gameServices.find((o) => o.gameSlug === g && o.serviceSlug === s)!;
    const input = buildTemporaryPriceInput(g, s)!;
    const price: ServicePriceConfig = {
      id: "x",
      version: 1,
      gameSlug: g,
      serviceSlug: s,
      currency: input.currency,
      pricingModel: input.pricingModel,
      baseAmount: input.baseAmount,
      stepAmounts: input.stepAmounts ?? null,
      unitFieldKey: input.unitFieldKey ?? null,
      unitAmount: input.unitAmount ?? null,
      optionPricing: input.optionPricing,
      modePricing: input.modePricing,
    };
    expect(computeStartingPrice(offer, getCheckoutConfig(g, s)!, price, POLICY)).toEqual({ amount: cents, currency: "USD" });
  });
});

describe("safeCallbackPath (sign-in return)", () => {
  it.each([
    ["/games/valorant/services/rank-boost", "/games/valorant/services/rank-boost"],
    ["/games?x=1#y", "/games?x=1#y"],
    [null, "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example/x", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["games", "/dashboard"],
  ])("%s -> %s", (input, out) => {
    expect(safeCallbackPath(input as string | null)).toBe(out);
  });
});
