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
import { isVpnCountry, matchesCountry, VPN_COUNTRIES, vpnCountryName, vpnCountryOptions } from "@/lib/catalog/vpn-countries";
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

  it("every country can be chosen, with no default; names follow the visitor's language", () => {
    expect(VPN_COUNTRIES.length).toBeGreaterThanOrEqual(245);
    for (const c of ["US", "DE", "TN", "AE", "BR", "KR", "NZ", "IS"]) expect(isVpnCountry(c)).toBe(true);
    expect(isVpnCountry("ZZ")).toBe(false);
    expect(vpnCountryName("DE", "en")).toBe("Germany");
    expect(vpnCountryName("DE", "fr")).toBe("Allemagne");
    // Every code has a real name (not just the code).
    for (const o of vpnCountryOptions("en")) expect(o.name, o.code).not.toBe(o.code);
  });

  it("search matches names without accents or case, and exact codes", () => {
    const fr = vpnCountryOptions("fr");
    expect(fr.filter((o) => matchesCountry(o, "alle")).map((o) => o.code)).toEqual(["DE"]);
    expect(fr.filter((o) => matchesCountry(o, "etats")).map((o) => o.code)).toContain("US");
    expect(vpnCountryOptions("en").filter((o) => matchesCountry(o, "tn")).map((o) => o.code)).toContain("TN");
    expect(fr.filter((o) => matchesCountry(o, "")).length).toBe(VPN_COUNTRIES.length);
  });
});

describe("Main and secondary role (client 2026-11-24)", () => {
  const withRoles = (roles: string[]) =>
    validateOrderInput(offer, checkout, request({ selectedOptions: [], championsRoles: { roles, champions: [] } }) as never);

  it("keeps the order: main first, secondary second", () => {
    const r = withRoles(["mid", "top"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.championsRoles?.roles).toEqual(["mid", "top"]);
    expect(withRoles(["mid"]).ok).toBe(true);
  });

  it("the secondary role cannot be the main role, and there are at most two", () => {
    const same = withRoles(["mid", "mid"]);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors).toContain("The secondary role must be different from the main role.");
    expect(withRoles(["mid", "top", "adc"]).ok).toBe(false);
  });
});

describe("Bid range and claim price (client 2026-11-24)", () => {
  it("bids go from the price minus 24.5 % to the price; claim is the price minus 25 %", async () => {
    const { CONFIG_DEFAULTS } = await import("@/lib/config");
    const { payoutAmounts } = await import("@/lib/pool/eligibility");
    expect(CONFIG_DEFAULTS.min_bid_bps).toBe(7550);
    expect(CONFIG_DEFAULTS.claim_now_discount_bps).toBe(2500);
    const a = payoutAmounts(10_000, { claimNowDiscountBps: CONFIG_DEFAULTS.claim_now_discount_bps, minBidBps: CONFIG_DEFAULTS.min_bid_bps });
    expect(a).toEqual({ ceiling: 10_000, claimNow: 7_500, minBid: 7_550 });
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
    expect(earningReason({ status: "PAID", allocationNote: null, order: order({ wins: 3 }, "win-boost") })).toBe("League Net Win Boost (3 net wins) · paid out");
    expect(earningReason({ status: "PENDING", allocationNote: "Tip from the customer", order: order({}) })).toBe("Tip from the customer · waiting for release");
  });
});

describe("Net Win / Placement Boost pages (client PDFs 2026-11-24)", () => {
  it("counts: net wins and placement games, from what the customer ordered", async () => {
    const { orderGameCount, countLabel } = await import("@/lib/orders/game-count");
    expect(orderGameCount("league-of-legends", "win-boost", { wins: 5 })).toMatchObject({ kind: "net-wins", total: 5, unit: "net wins", caption: "Net wins ordered" });
    expect(orderGameCount("league-of-legends", "placement-boost", { placementsRemaining: 3 })).toMatchObject({ kind: "placements", total: 3, caption: "Placement games ordered" });
    expect(orderGameCount("league-of-legends", "rank-boost", {})).toBeNull();
    expect(countLabel(1, "net wins")).toBe("1 net win");
    expect(countLabel(3, "placement games")).toBe("3 placement games");
  });

  it("Net Win Boost has its new address; the old one redirects", async () => {
    const { MOVED_SERVICE_PATHS, servicePath } = await import("@/lib/seo/short-paths");
    expect(servicePath("league-of-legends", "win-boost")).toBe("/lol-net-win-boost");
    expect(MOVED_SERVICE_PATHS["/lol-boosting"]).toBe("/lol-net-win-boost");
    expect(getGameServiceOffer("league-of-legends", "win-boost")!.title).toBe("Net Win Boost");
  });

  it("OTP Champ Only cannot be bought with Specific Champion and Role", () => {
    const r = validateOrderInput(offer, checkout, request({ selectedOptions: ["otp-champion", "champions-roles"], championsRoles: { roles: [], champions: [], otpChampion: "jinx" } }) as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("Specific Champion and Role is not available with OTP Champ Only.");
  });

});
