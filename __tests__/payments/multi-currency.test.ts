// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Multi-currency (2026-11-23): the customer picks USD, EUR or GBP; the
 * admin price list (here in EUR) is converted at the daily rate before the
 * price is calculated, and the order is charged in the chosen currency.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ offers: [] as any[], checkouts: [] as any[] }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/catalog/game-services", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog/game-services")>()),
  getGameServiceOffer: (g: string, s: string) => h.offers.find((o) => o.gameSlug === g && o.serviceSlug === s),
}));
vi.mock("@/lib/config/checkout-options", () => ({
  getCheckoutConfig: (g: string, s: string) => h.checkouts.find((c) => c.gameSlug === g && c.serviceSlug === s),
}));

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { configurePrice, rankCheckout, rankOffer, seedUser } from "../support/payment-fixtures";
import { buildServerQuote, CURRENCY_UNAVAILABLE_MESSAGE } from "@/lib/pricing/service";
import { createOrderForCustomer } from "@/lib/orders/order-creation.service";
import { clearFxCache, conversionFactor, convertPriceConfig, FX_CONFIG_KEY } from "@/lib/currency/rates";
import { clearConfigCache } from "@/lib/config";
import { resolveCurrency } from "@/lib/currency/currencies";
import type { ServicePriceConfig } from "@/lib/pricing/price-config";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let customer: { id: string };

// 1 USD = 0.9 EUR = 0.8 GBP  ->  1 EUR = 1.1111 USD = 0.8889 GBP.
const RATES = { base: "USD" as const, rates: { USD: 1, EUR: 0.9, GBP: 0.8 }, date: "2026-11-23" };

async function setRates(fetchedAt = new Date().toISOString()) {
  const value = { ...RATES, fetchedAt };
  await prisma.appConfig.upsert({ where: { key: FX_CONFIG_KEY }, create: { key: FX_CONFIG_KEY, value }, update: { value } });
  clearFxCache();
}

// Gold IV -> Gold I = base 25.00 + 3 x 25.00 = 100.00 EUR.
const request = (extra: Record<string, unknown> = {}) => ({
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "i" } },
  selectedOptions: [],
  ...extra,
});

beforeAll(async () => {
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  const admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  await configurePrice(admin.id, 2500, 2500);
}, 60_000);
afterAll(closeTestDb);
beforeEach(async () => {
  // Never call the real rate source in tests.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
  await prisma.appConfig.deleteMany({ where: { key: { in: [FX_CONFIG_KEY, "fx_markup_bps"] } } });
  clearConfigCache();
  await setRates();
});

describe("conversion", () => {
  it("rates go through USD; the same currency is never converted", () => {
    const fx = { ...RATES, fetchedAt: "" };
    expect(conversionFactor("EUR", "EUR", fx)).toBe(1);
    expect(conversionFactor("EUR", "USD", fx)).toBeCloseTo(1.1111, 4);
    expect(conversionFactor("EUR", "GBP", fx)).toBeCloseTo(0.8889, 4);
    expect(conversionFactor("EUR", "GBP", fx, 200)).toBeCloseTo(0.8889 * 1.02, 4);
    expect(conversionFactor("EUR", "JPY", fx)).toBeNull();
    expect(conversionFactor("EUR", "USD", null)).toBeNull();
  });

  it("converts every amount of the price list; percentages stay as they are", () => {
    const price = {
      id: "p", version: 1, gameSlug: "g", serviceSlug: "s", currency: "EUR", pricingModel: "RANK_STEPS",
      baseAmount: 1000, stepAmounts: { gold: 2500 }, unitFieldKey: null, unitAmount: null,
      optionPricing: { vpn: { type: "fixed", amount: 300 }, priority: { type: "bps", bps: 2500 } },
      modePricing: { duo: { type: "bps", bps: 5000 } },
    } as ServicePriceConfig;
    expect(convertPriceConfig(price, "USD", 1.1)).toMatchObject({
      currency: "USD",
      baseAmount: 1100,
      stepAmounts: { gold: 2750 },
      optionPricing: { vpn: { type: "fixed", amount: 330 }, priority: { type: "bps", bps: 2500 } },
      modePricing: { duo: { type: "bps", bps: 5000 } },
    });
  });

  it("the visitor's choice wins; otherwise euros in French and dollars in English", () => {
    expect(resolveCurrency("GBP", "fr")).toBe("GBP");
    expect(resolveCurrency(undefined, "fr")).toBe("EUR");
    expect(resolveCurrency("JPY", "en")).toBe("USD");
  });
});

describe("quote in the customer's currency", () => {
  it("no currency: the price list's own (EUR), unchanged", async () => {
    const { quote } = await buildServerQuote(request() as any);
    expect(quote).toMatchObject({ currency: "EUR", totalAmount: 10000, fx: null });
  });

  it("USD and GBP: converted at the daily rate, split still adds up", async () => {
    const usd = (await buildServerQuote(request({ currency: "USD" }) as any)).quote;
    expect(usd.currency).toBe("USD");
    expect(usd.totalAmount).toBe(11112); // 4 x round(2500 x 1.1111) = 4 x 2778
    expect(usd.commission.platformFeeAmount + usd.commission.boosterShareAmount).toBe(usd.commissionBaseAmount);
    expect(usd.fx).toMatchObject({ from: "EUR", to: "USD", date: "2026-11-23" });

    const gbp = (await buildServerQuote(request({ currency: "GBP" }) as any)).quote;
    expect(gbp).toMatchObject({ currency: "GBP", totalAmount: 8888 });
  });

  it("the admin's exchange margin is added on conversions only", async () => {
    await prisma.appConfig.create({ data: { key: "fx_markup_bps", value: 200 } });
    clearConfigCache();
    expect((await buildServerQuote(request({ currency: "USD" }) as any)).quote.totalAmount).toBe(11332); // 4 x round(2500 x 1.1333) = 4 x 2833
    expect((await buildServerQuote(request({ currency: "EUR" }) as any)).quote.totalAmount).toBe(10000);
  });

  it("without trustworthy rates only the price list's own currency can be bought", async () => {
    await setRates(new Date(Date.now() - 8 * 24 * 3600_000).toISOString()); // older than 7 days, source down
    await expect(buildServerQuote(request({ currency: "USD" }) as any)).rejects.toThrow(CURRENCY_UNAVAILABLE_MESSAGE);
    expect((await buildServerQuote(request({ currency: "EUR" }) as any)).quote.totalAmount).toBe(10000);
  });

  it("a shown total in another currency is refused (no charge on a price not seen)", async () => {
    await expect(
      buildServerQuote(request({ currency: "USD", expectedTotal: { amount: 10000, currency: "EUR" } }) as any)
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("order", () => {
  it("is charged in the chosen currency and keeps the rate it was priced with", async () => {
    const created: any = await createOrderForCustomer(
      customer.id,
      request({ currency: "GBP", riskAccepted: true, expectedTotal: { amount: 8888, currency: "GBP" } }) as any,
      uid("idem-fx")
    );
    const orderId = created.order?.id ?? created.id;
    const snap = await prisma.orderPricingSnapshot.findFirstOrThrow({ where: { orderId } });
    expect(snap).toMatchObject({ currency: "GBP", totalAmount: 8888 });
    expect((snap.breakdown as any).fx).toMatchObject({ from: "EUR", to: "GBP", date: "2026-11-23" });
    expect(snap.platformFeeAmount + snap.boosterShareAmount).toBe(snap.commissionBaseAmount);
  });
});
