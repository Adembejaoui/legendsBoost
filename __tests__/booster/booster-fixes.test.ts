// @vitest-environment node
/**
 * Booster fixes and additions (client PDF 2026-11-23): the VPN country the
 * customer picks, AED at its fixed USD rate, and the reasons shown on the
 * booster's Payments page.
 */
import { describe, it, expect } from "vitest";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { defaultVpnCountry, isVpnCountry, vpnCountryName } from "@/lib/catalog/vpn-countries";
import { conversionFactor, USD_PEGS } from "@/lib/currency/rates";
import { SITE_CURRENCIES } from "@/lib/currency/currencies";
import { earningReason } from "@/lib/finance/queries";

const offer = getGameServiceOffer("league-of-legends", "rank-boost")!;
const checkout = getCheckoutConfig("league-of-legends", "rank-boost")!;
const request = (extra: Record<string, unknown> = {}) => ({
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  configuration: {
    currentRank: { tierId: "silver", divisionId: "iv" },
    targetRank: { tierId: "gold", divisionId: "iv" },
    currentLp: "0-20",
    lpGain: "normal",
    server: "EUW1",
    queueType: "ranked-solo",
  },
  selectedMode: "solo" as const,
  selectedOptions: ["vpn"],
  ...extra,
});

describe("VPN country", () => {
  it("is saved with the VPN extra (upper-case code)", () => {
    const r = validateOrderInput(offer, checkout, request({ championsRoles: { roles: [], champions: [], vpnCountry: "de" } }) as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.championsRoles).toEqual({ roles: [], champions: [], vpnCountry: "DE" });
  });

  it("an unknown country is refused", () => {
    const r = validateOrderInput(offer, checkout, request({ championsRoles: { roles: [], champions: [], vpnCountry: "ZZ" } }) as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("Unknown VPN country: ZZ");
  });

  it("is dropped when the VPN extra is not bought", () => {
    const r = validateOrderInput(offer, checkout, request({ selectedOptions: [], championsRoles: { roles: [], champions: [], vpnCountry: "DE" } }) as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.championsRoles).toEqual({ roles: [], champions: [] });
  });

  it("defaults to the server's country; names follow the visitor's language", () => {
    expect(defaultVpnCountry("EUW1")).toBe("DE");
    expect(defaultVpnCountry("NA1")).toBe("US");
    expect(defaultVpnCountry(undefined)).toBe("US");
    for (const s of ["NA1", "BR1", "EUW1", "EUN1", "TR1", "KR", "JP1", "OC1"]) expect(isVpnCountry(defaultVpnCountry(s))).toBe(true);
    expect(vpnCountryName("DE", "en")).toBe("Germany");
    expect(vpnCountryName("DE", "fr")).toBe("Allemagne");
  });
});

describe("AED", () => {
  it("is a checkout currency at the fixed rate of 3.6725 per USD", () => {
    expect(SITE_CURRENCIES).toContain("AED");
    expect(USD_PEGS.AED).toBe(3.6725);
    const fx = { base: "USD" as const, rates: { USD: 1, EUR: 0.9, AED: 3.6725 }, date: "2026-11-23", fetchedAt: "" };
    expect(conversionFactor("USD", "AED", fx)).toBeCloseTo(3.6725, 6);
    expect(conversionFactor("EUR", "AED", fx)).toBeCloseTo(3.6725 / 0.9, 6);
  });
});

describe("Payments page reasons", () => {
  const order = (configuration: unknown, serviceSlug = "rank-boost") => ({ gameSlug: "league-of-legends", serviceSlug, configuration });

  it("rank orders show the route and the state", () => {
    expect(
      earningReason({
        status: "AVAILABLE",
        allocationNote: null,
        order: order({ currentRank: { tierId: "silver", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "iv" } }),
      }),
    ).toBe("League Rank Boost (Silver IV → Gold IV) · completed");
  });

  it("win orders show the wins; tips say so", () => {
    expect(earningReason({ status: "PAID", allocationNote: null, order: order({ wins: 3 }, "win-boost") })).toBe("League Win Boost (3 wins) · paid out");
    expect(earningReason({ status: "PENDING", allocationNote: "Tip from the customer", order: order({}) })).toBe("Tip from the customer · waiting for release");
  });
});
