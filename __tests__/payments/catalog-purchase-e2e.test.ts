// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * End-to-end purchase flow for EVERY catalog service, against an in-memory
 * PostgreSQL (real migration, constraints and ledger) and a fake Stripe API
 * (real webhook signature verification). No network, no live Stripe.
 *
 * The catalog is the REAL one (fields, rank systems, modes, options). Only
 * the four sellability flags are overridden to "approved" INSIDE THIS TEST,
 * to prove each service completes the flow once it is approved. Production
 * approval lives in lib/catalog/game-services.ts and
 * lib/config/checkout-options.ts and is not changed by this test.
 *
 * Prices are TEST FIXTURES created through the real admin service.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), stripe: null as any }));
const { APPROVED } = vi.hoisted(() => ({ APPROVED: { availability: "available", orderCapability: "live-order", complianceStatus: "approved" } as const }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/catalog/game-services", async (orig) => {
  const actual = await orig<typeof import("@/lib/catalog/game-services")>();
  const gameServices = actual.gameServices.map((o) => ({ ...o, ...APPROVED }));
  return { ...actual, gameServices, getGameServiceOffer: (g: string, s: string) => gameServices.find((o) => o.gameSlug === g && o.serviceSlug === s) };
});
vi.mock("@/lib/config/checkout-options", async (orig) => {
  const actual = await orig<typeof import("@/lib/config/checkout-options")>();
  const checkoutConfigs = actual.checkoutConfigs.map((c) => ({ ...c, ...APPROVED, allowOrder: true }));
  return { ...actual, checkoutConfigs, getCheckoutConfig: (g: string, s: string) => checkoutConfigs.find((c) => c.gameSlug === g && c.serviceSlug === s) };
});
vi.mock("@/lib/stripe/server", async (orig) => {
  const actual = await orig<typeof import("@/lib/stripe/server")>();
  return { ...actual, getStripe: () => h.stripe.client };
});

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { createFakeStripe, stripeEvent, WEBHOOK_SECRET } from "../support/fake-stripe";
import { deliver, ledgerFor, seedUser, sessionFor, sum } from "../support/payment-fixtures";
import { enabledModes, enabledOptionsFor, expectedTotal, fixturePriceInput, pricingModelFor, validConfiguration } from "../support/catalog-fixtures";
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { createServicePriceVersion } from "@/lib/pricing/admin.service";
import { POST as quoteRoute } from "@/app/api/orders/quote/route";
import { POST as createOrderRoute } from "@/app/api/orders/route";
import { POST as checkoutRoute } from "@/app/api/orders/[orderId]/checkout/route";
import { getAvailableOrders, claimOrder } from "@/lib/assignments/service";
import { champions as championList } from "@/lib/catalog/champions";

/** OTP Champ Only needs its champion (client PDFs 2026-11-19). */
const otpFor = (selectedOptions: string[]) =>
  selectedOptions.includes("otp-champion") ? { championsRoles: { roles: [], champions: [], otpChampion: championList[0].id } } : {};

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }) as unknown as NextRequest;
const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) });

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.stripe = createFakeStripe();
  admin = await seedUser("ADMIN");
}, 60_000);
afterAll(closeTestDb);

describe.each(gameServices.map((o) => [`${o.gameSlug}:${o.serviceSlug}`, o] as const))("%s", (_key, offer) => {
  const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug)!;
  const modes = enabledModes(checkout);
  const mode = modes[0] ?? null;

  it("completes the purchase flow: price -> quote -> order -> Stripe -> webhook -> pool -> claim", async () => {
    const customer = await seedUser("CUSTOMER");
    h.getSessionUser.mockResolvedValue(customer);
    const base = { gameSlug: offer.gameSlug, serviceSlug: offer.serviceSlug };

    // 0. Not purchasable while unpriced (no silent fallback price).
    const { configuration, steps, units } = validConfiguration(offer);
    const options = enabledOptionsFor(checkout, mode);
    const request = { ...base, configuration, selectedMode: mode ?? undefined, selectedOptions: options, riskAccepted: true as const, ...otpFor(options) };
    const unpriced = await quoteRoute(json("http://t/q", request));
    expect(unpriced.status).toBe(403);
    expect((await unpriced.json()).error).toBe("No price is configured for this service yet.");

    // 1. Admin configures a price (fixture amounts) through the real admin service.
    const tiers = offer.rankSystemId ? (getRankSystem(offer.rankSystemId)?.tiers ?? []).map((t) => t.id) : [];
    const price = await createServicePriceVersion(admin.id, fixturePriceInput(offer, checkout, tiers));
    expect(price).toMatchObject({ status: "ACTIVE", activeKey: `${offer.gameSlug}:${offer.serviceSlug}`, pricingModel: pricingModelFor(offer).model });

    // 2. Quote returns the server price for every mode with every option of that mode.
    for (const m of modes.length ? modes : [null]) {
      const opts = enabledOptionsFor(checkout, m);
      const res = await quoteRoute(json("http://t/q", { ...request, selectedMode: m ?? undefined, selectedOptions: opts, ...otpFor(opts) }));
      const body = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.quote).toMatchObject({ currency: "EUR", totalAmount: expectedTotal(offer, steps, units, m !== null, opts.length) });
      expect(body.quote.commission).toBeUndefined(); // internal split never leaves the server
    }
    const total = expectedTotal(offer, steps, units, mode !== null, options.length);

    // 3. Invalid configurations are rejected.
    const bad = [
      { ...request, configuration: { ...configuration, injected: 1 } },
      { ...request, selectedOptions: ["not-an-option"] },
      { ...request, totalAmount: 1 },
      ...(modes.length ? [{ ...request, selectedMode: undefined }] : [{ ...request, selectedMode: "duo" }]),
      ...(pricingModelFor(offer).model === "RANK_STEPS" ? [{ ...request, configuration: { ...configuration, targetRank: configuration.currentRank } }] : []),
      ...(pricingModelFor(offer).model === "PER_UNIT" ? [{ ...request, configuration: { ...configuration, [pricingModelFor(offer).unitFieldKey!]: 0 } }] : []),
    ];
    for (const b of bad) expect((await quoteRoute(json("http://t/q", b))).status, JSON.stringify(b)).toBe(400);
    expect(await prisma.order.count({ where: { userId: customer.id } })).toBe(0);

    // 4. A manipulated expected total is refused; the shown total creates the order.
    const key = uid("idem-key-catalog-e2e");
    expect((await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total - 1, currency: "EUR" } }, { "Idempotency-Key": key }))).status).toBe(409);
    const created = await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total, currency: "EUR" } }, { "Idempotency-Key": key }));
    const createdBody = await created.json();
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const orderId: string = createdBody.order.id;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { pricingSnapshot: true } });
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", paymentVerifiedAt: null });
    expect(order.pricingSnapshot).toMatchObject({ totalAmount: total, currency: "EUR", platformFeeBps: 4500, boosterShareBps: 5500 });

    // 5. Unpaid: never visible to boosters, never claimable.
    const booster = await seedUser("BOOSTER");
    expect((await getAvailableOrders()).map((o: any) => o.id)).not.toContain(orderId);
    await expect(claimOrder(orderId, booster.id)).rejects.toThrow();

    // 6. Stripe Checkout session (test fake) for exactly the snapshot amount.
    const before = h.stripe.state.sessionCreateCalls.length;
    const co = await checkoutRoute(new Request("http://t/c", { method: "POST" }) as unknown as NextRequest, params(orderId));
    expect(co.status).toBe(200);
    const call = h.stripe.state.sessionCreateCalls[before];
    expect(call.params.line_items[0].price_data).toMatchObject({ currency: "eur", unit_amount: total });
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });

    // 7. Signed webhook verifies the payment; a bad signature changes nothing.
    expect((await deliver(stripeEvent("checkout.session.completed", await sessionFor(payment.id)), { badSignature: true })).status).toBe(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentVerifiedAt).toBeNull();
    const hook = await deliver(stripeEvent("checkout.session.completed", await sessionFor(payment.id)));
    expect(hook, JSON.stringify(hook.body)).toMatchObject({ status: 200, body: { outcome: "payment_succeeded" } });

    // 8. Paid: visible in the pool.
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(paid.status).toBe("PENDING");
    expect(paid.paymentVerifiedAt).toBeInstanceOf(Date);
    expect((await getAvailableOrders()).map((o: any) => o.id)).toContain(orderId);

    // 9. Booster claims it.
    await claimOrder(orderId, booster.id);
    expect(await prisma.orderBoosterAssignment.count({ where: { orderId, activeOrderId: orderId, boosterId: booster.id } })).toBe(1);

    // 10. Ledger: payment = 45% platform + 55% booster share, exactly.
    const ledger = await ledgerFor(orderId);
    const platform = sum(ledger, (t) => t.type === "PLATFORM_COMMISSION");
    const boosterShare = sum(ledger, (t) => t.type === "BOOSTER_SHARE_RESERVED");
    expect(sum(ledger, (t) => t.type === "CUSTOMER_PAYMENT")).toBe(total);
    expect(platform + boosterShare).toBe(total);
    expect(platform).toBe(order.pricingSnapshot!.platformFeeAmount);
    expect(boosterShare).toBe(order.pricingSnapshot!.boosterShareAmount);
    expect(Math.abs(platform - (total * 45) / 100)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("Stripe edge cases: idempotent checkout, duplicates, mismatches, delayed, failed and expired payments", async () => {
    const customer = await seedUser("CUSTOMER");
    h.getSessionUser.mockResolvedValue(customer);
    const tiers = offer.rankSystemId ? (getRankSystem(offer.rankSystemId)?.tiers ?? []).map((t) => t.id) : [];
    if (!(await prisma.servicePrice.findUnique({ where: { activeKey: `${offer.gameSlug}:${offer.serviceSlug}` } }))) {
      await createServicePriceVersion(admin.id, fixturePriceInput(offer, checkout, tiers));
    }
    const { configuration, steps, units } = validConfiguration(offer);
    const options = enabledOptionsFor(checkout, mode);
    const total = expectedTotal(offer, steps, units, mode !== null, options.length);
    const request = { gameSlug: offer.gameSlug, serviceSlug: offer.serviceSlug, configuration, selectedMode: mode ?? undefined, selectedOptions: options, riskAccepted: true as const, ...otpFor(options) };

    const newOrder = async () => {
      const key = uid("idem-key-catalog-edge");
      const res = await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total, currency: "EUR" } }, { "Idempotency-Key": key }));
      expect(res.status).toBe(201);
      const id: string = (await res.json()).order.id;
      // Same key, same request -> the same order (no duplicate).
      const replay = await createOrderRoute(json("http://t/o", { ...request, expectedTotal: { amount: total, currency: "EUR" } }, { "Idempotency-Key": key }));
      expect(replay.status).toBe(200);
      expect((await replay.json()).order.id).toBe(id);
      return id;
    };
    const startCheckout = async (orderId: string) => {
      const res = await checkoutRoute(new Request("http://t/c", { method: "POST" }) as unknown as NextRequest, params(orderId));
      expect(res.status).toBe(200);
      return res.json();
    };
    const latestPayment = (orderId: string) => prisma.payment.findFirstOrThrow({ where: { orderId }, orderBy: { attemptNumber: "desc" } });
    const isPublished = async (orderId: string) => {
      const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      return o.paymentVerifiedAt !== null && (await getAvailableOrders()).some((x: any) => x.id === orderId);
    };

    // Idempotent checkout: a second request reuses the open session.
    const a = await newOrder();
    const first = await startCheckout(a);
    const calls = h.stripe.state.sessionCreateCalls.length;
    const again = await startCheckout(a);
    expect(again).toMatchObject({ url: first.url, reused: true });
    expect(h.stripe.state.sessionCreateCalls.length).toBe(calls);

    // Duplicate webhook: processed once, ledger posted once.
    const pa = await latestPayment(a);
    const event = stripeEvent("checkout.session.completed", await sessionFor(pa.id));
    expect((await deliver(event)).body.outcome).toBe("payment_succeeded");
    expect((await deliver(event)).body).toMatchObject({ duplicate: true });
    const ledgerA = await ledgerFor(a);
    expect(ledgerA.filter((t) => t.type === "CUSTOMER_PAYMENT")).toHaveLength(1);
    expect(ledgerA.filter((t) => t.type === "PLATFORM_COMMISSION")).toHaveLength(1);
    expect(ledgerA.filter((t) => t.type === "BOOSTER_SHARE_RESERVED")).toHaveLength(1);

    // Amount and currency mismatches: recorded for review, never published.
    for (const [override, outcome] of [
      [{ amount_total: total - 1 }, "payment_needs_review_amount_mismatch"],
      [{ currency: "usd" }, "payment_needs_review_currency_mismatch"],
    ] as const) {
      const o = await newOrder();
      await startCheckout(o);
      const p = await latestPayment(o);
      expect((await deliver(stripeEvent("checkout.session.completed", await sessionFor(p.id, override)))).body.outcome).toBe(outcome);
      expect(await isPublished(o)).toBe(false);
      expect(await prisma.boosterEarning.count({ where: { orderId: o } })).toBe(0);
    }

    // Delayed payment: completed+unpaid -> PROCESSING (not claimable) -> async success -> published.
    const d = await newOrder();
    await startCheckout(d);
    const pd = await latestPayment(d);
    expect((await deliver(stripeEvent("checkout.session.completed", await sessionFor(pd.id, { payment_status: "unpaid" })))).body.outcome).toBe("awaiting_async_payment");
    expect(await isPublished(d)).toBe(false);
    expect((await deliver(stripeEvent("checkout.session.async_payment_succeeded", await sessionFor(pd.id)))).body.outcome).toBe("payment_succeeded");
    expect(await isPublished(d)).toBe(true);

    // Failed payment: no order is created. The checkout hold is closed and
    // cannot be paid later; the customer starts a new checkout.
    const f = await newOrder();
    await startCheckout(f);
    const pf = await latestPayment(f);
    expect((await deliver(stripeEvent("checkout.session.async_payment_failed", await sessionFor(pf.id, { payment_status: "unpaid" })))).body.outcome).toBe("payment_failed");
    expect(await isPublished(f)).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f } })).status).toBe("CANCELLED");
    expect((await checkoutRoute(new Request("http://t/c", { method: "POST" }) as unknown as NextRequest, params(f))).status).toBe(409);
    const f2 = await newOrder();
    await startCheckout(f2);
    expect((await deliver(stripeEvent("checkout.session.completed", await sessionFor((await latestPayment(f2)).id)))).body.outcome).toBe("payment_succeeded");
    expect(await isPublished(f2)).toBe(true);

    // Abandoned checkout: the session expires and the hold is closed (no order).
    const e = await newOrder();
    await startCheckout(e);
    const pe = await latestPayment(e);
    expect((await deliver(stripeEvent("checkout.session.expired", await sessionFor(pe.id, { payment_status: "unpaid" })))).body.outcome).toBe("session_expired");
    expect(await isPublished(e)).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: e } })).status).toBe("CANCELLED");
    expect((await checkoutRoute(new Request("http://t/c", { method: "POST" }) as unknown as NextRequest, params(e))).status).toBe(409);
  }, 120_000);
});
