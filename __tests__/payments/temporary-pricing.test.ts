// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * The owner-supplied TEMPORARY prices against the REAL catalog: the real
 * flags, with compliance still "pending-review", and no catalog mocks. Stripe
 * runs with a TEST key (fake client, no network), the database is an
 * in-memory PostgreSQL with the real migrations.
 *
 *  1. pure: every price input is valid; every selectable configuration of
 *     every priced service gets exactly the owner's price; invalid ones are
 *     rejected; compliance is waived ONLY in Stripe test mode.
 *  2. routes: prices applied through the real admin service (the same call
 *     the apply script makes); quote, order creation and Stripe Checkout
 *     preparation per service. No payment is completed here.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/stripe/server", async (orig) => {
  const actual = await orig<typeof import("@/lib/stripe/server")>();
  return { ...actual, getStripe: () => h.stripe.client };
});

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { seedUser } from "../support/payment-fixtures";
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { champions } from "@/lib/catalog/champions";
import { evaluateOrderEligibility, getOrderEligibility, getPurchaseStatus } from "@/lib/orders/order-eligibility";
import { calculateQuote, rankLadder } from "@/lib/pricing/engine";
import { validateOrderInput } from "@/lib/pricing/order-input";
import { validateServicePriceAgainstCatalog, type ServicePriceConfig } from "@/lib/pricing/price-config";
import { allTemporaryPriceInputs, buildTemporaryPriceInput, UNPRICED_SERVICES } from "@/lib/pricing/temporary-prices";
import { createServicePriceVersion } from "@/lib/pricing/admin.service";
import { POST as quoteRoute } from "@/app/api/orders/quote/route";
import { POST as createOrderRoute } from "@/app/api/orders/route";
import { POST as checkoutRoute } from "@/app/api/orders/[orderId]/checkout/route";
import { getAvailableOrders } from "@/lib/assignments/service";

/**
 * The owner's list, written independently of lib/pricing/temporary-prices.ts
 * (USD cents). Modes and extras add $0.
 */
const OWNER_PRICE: Record<string, (c: Record<string, any>) => number> = {
  "league-of-legends:rank-boost": () => 1000,
  "league-of-legends:win-boost": (c) => 300 * c.wins,
  "league-of-legends:placement-boost": () => 800,
  "league-of-legends:champion-mastery": () => 500,
  "valorant:rank-boost": () => 1000,
  "valorant:win-boost": (c) => 300 * c.wins,
  "valorant:placement-boost": () => 800,
  "teamfight-tactics:rank-boost": () => 1000,
  "teamfight-tactics:win-boost": (c) => 300 * c.wins,
  "teamfight-tactics:placement-boost": () => 800,
  "teamfight-tactics:double-up-boost": () => 1000,
};
const UNPRICED = ["league-of-legends:arena-boost", "league-of-legends:normal-matches", "valorant:unrated-matches"];
const POLICY = { id: "policy", platformFeeBps: 4500, boosterShareBps: 5500 };

const keyOf = (o: { gameSlug: string; serviceSlug: string }) => `${o.gameSlug}:${o.serviceSlug}`;

/** Every value a customer can choose for a field (undefined = left empty, when optional). */
function domain(f: any): unknown[] {
  const opt = f.required ? [] : [undefined];
  switch (f.type) {
    case "rank-picker":
      return [...opt, ...rankLadder(f.rankSystemId)];
    case "number": {
      const out: unknown[] = [...opt];
      for (let n = f.min ?? 1; n <= (f.max ?? f.min ?? 1); n++) out.push(n);
      return out;
    }
    case "select":
      return [...opt, ...f.options.map((o: any) => o.value)];
    case "multi-select":
      return [undefined, ...f.options.map((o: any) => [o.value]), f.options.map((o: any) => o.value)];
    case "champion-picker":
      return [...opt, ...champions.map((c) => c.id)];
    case "checkbox":
      return [...opt, true, false];
    default:
      throw new Error(`unhandled field type ${f.type}`);
  }
}

/** Fields that never change the price: one value is enough (keeps the loop fast). */
const PRICE_NEUTRAL = new Set(["server", "queueType"]);

function* configurations(fields: any[]): Generator<Record<string, unknown>> {
  if (fields.length === 0) {
    yield {};
    return;
  }
  const [first, ...rest] = fields;
  const values = PRICE_NEUTRAL.has(first.key) ? [first.options?.[0]?.value] : domain(first);
  for (const v of values) for (const tail of configurations(rest)) yield v === undefined ? tail : { [first.key]: v, ...tail };
}

/** Option selections to try per mode: none, each enabled option alone, all enabled together. */
/** OTP Champ Only needs its champion (client PDFs 2026-11-19). */
const otpFor = (selectedOptions: string[]) =>
  selectedOptions.includes("otp-champion") ? { championsRoles: { roles: [], champions: [], otpChampion: champions[0].id } } : {};

function optionSets(checkout: any, mode: string | null): string[][] {
  const ids = checkout.options.filter((o: any) => o.enabled && (!mode || !o.availableModes || o.availableModes.includes(mode))).map((o: any) => o.id);
  return [[], ...ids.map((id: string) => [id]), ...(ids.length > 1 ? [ids] : [])];
}

const asConfig = (input: ReturnType<typeof buildTemporaryPriceInput>, id = "p"): ServicePriceConfig => ({
  id,
  version: 1,
  gameSlug: input!.gameSlug,
  serviceSlug: input!.serviceSlug,
  currency: input!.currency,
  pricingModel: input!.pricingModel,
  baseAmount: input!.baseAmount,
  stepAmounts: input!.stepAmounts ?? null,
  unitFieldKey: input!.unitFieldKey ?? null,
  unitAmount: input!.unitAmount ?? null,
  optionPricing: input!.optionPricing,
  modePricing: input!.modePricing,
});

describe("temporary prices: definition", () => {
  it("covers the catalog: 11 priced services, 3 deliberately unpriced", () => {
    expect(gameServices).toHaveLength(14);
    expect(allTemporaryPriceInputs().map(keyOf).sort()).toEqual(Object.keys(OWNER_PRICE).sort());
    expect([...UNPRICED_SERVICES].sort()).toEqual([...UNPRICED].sort());
  });

  it.each(Object.keys(OWNER_PRICE))("%s: valid admin input, USD integer cents, marked TEMPORARY", (key) => {
    const [g, s] = key.split(":");
    const input = buildTemporaryPriceInput(g, s)!;
    expect(validateServicePriceAgainstCatalog(input)).toEqual([]);
    expect(input.currency).toBe("USD");
    expect(input.note).toMatch(/^TEMPORARY/);
    for (const n of [input.baseAmount, input.unitAmount ?? 0, ...Object.values(input.stepAmounts ?? {})]) expect(Number.isInteger(n)).toBe(true);
  });
});

describe("eligibility: publication vs compliance", () => {
  it.each(gameServices.map((o) => [keyOf(o), o] as const))("%s: published, compliance still pending; orderable only with Stripe TEST keys", (_k, offer) => {
    const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug)!;
    expect(offer).toMatchObject({ availability: "available", orderCapability: "live-order", visibility: "visible", complianceStatus: "pending-review" });
    expect(checkout).toMatchObject({ availability: "available", orderCapability: "live-order", allowOrder: true, complianceStatus: "pending-review" });
    expect(evaluateOrderEligibility(offer, checkout, "test")).toMatchObject({ ok: true, complianceWaivedForTestMode: true });
    expect(evaluateOrderEligibility(offer, checkout, "live").ok).toBe(false);
    expect(evaluateOrderEligibility(offer, checkout, "unconfigured").ok).toBe(false);
    expect(evaluateOrderEligibility(offer, checkout).ok).toBe(false); // default is the strict (live) rule
    expect(evaluateOrderEligibility({ ...offer, complianceStatus: "rejected" }, checkout, "test").ok).toBe(false);
    expect(evaluateOrderEligibility({ ...offer, complianceStatus: "approved" }, { ...checkout, complianceStatus: "approved" }, "live")).toMatchObject({
      ok: true,
      complianceWaivedForTestMode: false,
    });
  });
});

describe("temporary prices: every selectable configuration", () => {
  it.each(Object.keys(OWNER_PRICE))("%s", (key) => {
    const offer = gameServices.find((o) => keyOf(o) === key)!;
    const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug)!;
    const price = asConfig(buildTemporaryPriceInput(offer.gameSlug, offer.serviceSlug));
    const modes = (checkout.modes ?? []).filter((m) => m.enabled).map((m) => m.id);
    let valid = 0;
    let rejected = 0;
    for (const configuration of configurations(offer.fields)) {
      for (const mode of modes.length ? modes : [null]) {
        for (const selectedOptions of optionSets(checkout, mode)) {
          const v = validateOrderInput(offer, checkout, { gameSlug: offer.gameSlug, serviceSlug: offer.serviceSlug, configuration, selectedMode: mode ?? undefined, selectedOptions, ...otpFor(selectedOptions) });
          if (!v.ok) {
            rejected++;
            continue;
          }
          const q = calculateQuote(offer, checkout, price, POLICY, v.value);
          if (!q.ok) throw new Error(`${key} ${JSON.stringify({ configuration, mode, selectedOptions })}: ${q.reason}`);
          expect(q.quote.currency).toBe("USD");
          if (q.quote.totalAmount !== OWNER_PRICE[key](configuration)) {
            throw new Error(`${key} ${JSON.stringify({ configuration, mode, selectedOptions })}: ${q.quote.totalAmount}`);
          }
          expect(q.quote.commission.platformFeeAmount + q.quote.commission.boosterShareAmount).toBe(q.quote.totalAmount);
          valid++;
        }
      }
    }
    expect(valid).toBeGreaterThan(0);
    // Only rank boosts produce invalid combinations here (target not above current).
    if (!offer.fields.some((f) => f.key === "targetRank")) expect(rejected).toBe(0);
  }, 60_000);
});

describe("routes: quote -> order -> Stripe Checkout preparation (test mode, no payment)", () => {
  let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
  let admin: { id: string };
  const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }) as unknown as NextRequest;
  const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) });
  const savedKey = process.env.STRIPE_SECRET_KEY;

  /** A representative valid request: lowest rank -> 2 steps up, number fields at their minimum. */
  function representative(offer: (typeof gameServices)[number]) {
    const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug)!;
    const configuration: Record<string, unknown> = {};
    for (const f of offer.fields as any[]) {
      if (!f.required) continue;
      if (f.type === "rank-picker") configuration[f.key] = rankLadder(f.rankSystemId)[f.key === "targetRank" ? 2 : 0];
      if (f.type === "number") configuration[f.key] = f.min ?? 1;
      if (f.type === "champion-picker") configuration[f.key] = champions[0].id;
    }
    const mode = (checkout.modes ?? []).find((m) => m.enabled)?.id;
    const selectedOptions = optionSets(checkout, mode ?? null).at(-1)!;
    return { gameSlug: offer.gameSlug, serviceSlug: offer.serviceSlug, configuration, selectedMode: mode, selectedOptions, riskAccepted: true as const, ...otpFor(selectedOptions) };
  }

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_tests";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.APP_URL = "https://staging.legendsboost.test";
    prisma = await getTestPrisma();
    h.stripe = createFakeStripe();
    admin = await seedUser("ADMIN");
    // Same call, same inputs as scripts/apply-temporary-prices.ts --apply.
    for (const input of allTemporaryPriceInputs()) await createServicePriceVersion(admin.id, input);
  }, 60_000);
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_tests";
  });
  afterAll(async () => {
    process.env.STRIPE_SECRET_KEY = savedKey;
    await closeTestDb();
  });

  it("writes exactly one ServicePrice and one TEMPORARY audit row per priced service, nothing else", async () => {
    expect(await prisma.servicePrice.count({ where: { status: "ACTIVE" } })).toBe(11);
    const audits = await prisma.financialAuditLog.findMany({ where: { action: "SERVICE_PRICE_CREATED" } });
    expect(audits).toHaveLength(11);
    for (const a of audits) expect((a.details as any).input.note).toMatch(/^TEMPORARY/);
    expect(await prisma.financialTransaction.count()).toBe(0);
  });

  it.each(gameServices.map((o) => [keyOf(o), o] as const))("%s", async (key, offer) => {
    const customer = await seedUser("CUSTOMER");
    h.getSessionUser.mockResolvedValue(customer);
    const request = representative(offer);
    expect(getPurchaseStatus(offer.gameSlug, offer.serviceSlug)).toEqual({ orderable: true, testMode: true });

    const quote = await quoteRoute(json("http://t/q", request));
    const body = await quote.json();

    if (UNPRICED.includes(key)) {
      // No fallback price: an unpriced service cannot be quoted or ordered.
      expect(quote.status).toBe(403);
      expect(body.error).toBe("No price is configured for this service yet.");
      const o = await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: 1000, currency: "USD" } }, { "Idempotency-Key": uid("idem-unpriced") }));
      expect(o.status).toBe(403);
      expect(await prisma.order.count({ where: { userId: customer.id } })).toBe(0);
      return;
    }

    const total = OWNER_PRICE[key](request.configuration);
    expect(quote.status, JSON.stringify(body)).toBe(200);
    expect(body.quote).toMatchObject({ currency: "USD", totalAmount: total });
    expect(body.quote.commission).toBeUndefined();

    // Invalid configurations and client-supplied prices are rejected.
    const invalid = [
      { ...request, configuration: { ...request.configuration, injected: 1 } },
      { ...request, selectedOptions: ["not-an-option"] },
      { ...request, totalAmount: 1 },
      { ...request, price: 1 },
      ...(request.configuration.targetRank ? [{ ...request, configuration: { ...request.configuration, targetRank: request.configuration.currentRank } }] : []),
      ...(request.configuration.wins ? [{ ...request, configuration: { ...request.configuration, wins: 0 } }] : []),
    ];
    for (const b of invalid) expect((await quoteRoute(json("http://t/q", b))).status, JSON.stringify(b)).toBe(400);

    // Order creation at the shown price only.
    const idem = uid("idem-temp-price");
    expect((await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total - 1, currency: "USD" } }, { "Idempotency-Key": idem }))).status).toBe(409);
    expect((await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total, currency: "EUR" } }, { "Idempotency-Key": uid("idem-cur") }))).status).toBe(409);
    const created = await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total, currency: "USD" } }, { "Idempotency-Key": idem }));
    const createdBody = await created.json();
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const orderId: string = createdBody.order.id;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { pricingSnapshot: true } });
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", paymentVerifiedAt: null });
    expect(order.pricingSnapshot).toMatchObject({ currency: "USD", totalAmount: total, platformFeeBps: 4500, boosterShareBps: 5500 });
    expect(order.pricingSnapshot!.platformFeeAmount + order.pricingSnapshot!.boosterShareAmount).toBe(total);

    // Stripe Checkout preparation: server amount and currency, test-mode client.
    const before = h.stripe.state.sessionCreateCalls.length;
    const co = await checkoutRoute(new Request("http://t/c", { method: "POST" }) as unknown as NextRequest, params(orderId));
    expect(co.status).toBe(200);
    expect(h.stripe.state.sessionCreateCalls[before].params.line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: total });

    // Not paid: not in the booster marketplace, no ledger rows.
    expect((await getAvailableOrders()).map((o: any) => o.id)).not.toContain(orderId);
    expect(await prisma.financialTransaction.count({ where: { orderId } })).toBe(0);
  }, 60_000);

  it("with LIVE keys, compliance-pending services cannot be quoted, ordered or paid (even orders created in test mode)", async () => {
    const offer = gameServices.find((o) => keyOf(o) === "league-of-legends:rank-boost")!;
    const customer = await seedUser("CUSTOMER");
    h.getSessionUser.mockResolvedValue(customer);
    const request = representative(offer);
    const created = await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: 1000, currency: "USD" } }, { "Idempotency-Key": uid("idem-live") }));
    expect(created.status).toBe(201);
    const orderId: string = (await created.json()).order.id;

    process.env.STRIPE_SECRET_KEY = "sk_live_fake_for_unit_tests";
    expect(getOrderEligibility(offer.gameSlug, offer.serviceSlug).ok).toBe(false);
    expect((await quoteRoute(json("http://t/q", request))).status).toBe(403);
    expect((await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: 1000, currency: "USD" } }, { "Idempotency-Key": uid("idem-live2") }))).status).toBe(403);
    const before = h.stripe.state.sessionCreateCalls.length;
    const co = await checkoutRoute(new Request("http://t/c", { method: "POST" }) as unknown as NextRequest, params(orderId));
    expect(co.status).toBe(403);
    expect(h.stripe.state.sessionCreateCalls.length).toBe(before);
  });
});
