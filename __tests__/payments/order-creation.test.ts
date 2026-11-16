// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase A: server-side pricing and order creation against a real (in-memory)
 * PostgreSQL built from the migration.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), offers: [] as any[], checkouts: [] as any[] }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/catalog/game-services", () => ({
  getGameServiceOffer: (g: string, s: string) => h.offers.find((o) => o.gameSlug === g && o.serviceSlug === s),
}));
vi.mock("@/lib/config/checkout-options", () => ({
  getCheckoutConfig: (g: string, s: string) => h.checkouts.find((c) => c.gameSlug === g && c.serviceSlug === s),
}));

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { POST as createOrderRoute } from "@/app/api/orders/route";
import { POST as quoteRoute } from "@/app/api/orders/quote/route";
import { createCommissionPolicy, createServicePriceVersion } from "@/lib/pricing/admin.service";
import { getAvailableOrders } from "@/lib/assignments/service";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
const ADMIN = { id: "admin-oc", role: "ADMIN" };
const CUSTOMER = { id: "cust-oc", role: "CUSTOMER" };
const BOOSTER = { id: "boost-oc", role: "BOOSTER" };

const rankOffer = {
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  title: "Rank Boost",
  rankSystemId: "lol-ranked",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
  fields: [
    { type: "rank-picker", key: "currentRank", label: "Current rank", required: true, rankSystemId: "lol-ranked" },
    { type: "rank-picker", key: "targetRank", label: "Target rank", required: true, rankSystemId: "lol-ranked" },
    { type: "select", key: "server", label: "Server", required: true, options: [{ label: "EUW", value: "euw" }, { label: "NA", value: "na" }] },
  ],
};
const rankCheckout = {
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
  allowOrder: true,
  modes: [{ id: "solo", label: "Solo", enabled: true }, { id: "duo", label: "Duo", enabled: true }],
  options: [
    { id: "priority", label: "Priority", type: "toggle", enabled: true, availableModes: ["solo", "duo"] },
    { id: "stream", label: "Stream", type: "toggle", enabled: true, availableModes: ["solo"] },
    { id: "unpriced", label: "Unpriced", type: "toggle", enabled: true },
  ],
};

const config = (cur = { tierId: "gold", divisionId: "iv" }, tgt = { tierId: "gold", divisionId: "i" }) => ({
  currentRank: cur,
  targetRank: tgt,
  server: "euw",
});
const body = (extra: Record<string, unknown> = {}) => ({
  riskAccepted: true,
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  configuration: config(),
  selectedMode: "solo",
  selectedOptions: [],
  ...extra,
});
const post = (url: string, payload: unknown, key?: string | null) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
const create = (payload: unknown, key: string | null = uid("idem-key-long")) => createOrderRoute(post("http://t/api/orders", payload, key));

beforeAll(async () => {
  prisma = await getTestPrisma();
  for (const u of [ADMIN, CUSTOMER, BOOSTER]) {
    await prisma.user.create({ data: { id: u.id, email: `${u.id}@t.test`, role: u.role as any } });
  }
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  // Gold IV -> Gold I is 3 steps at 25.00 each + base 25.00 = 100.00 EUR.
  await createServicePriceVersion(ADMIN.id, {
    gameSlug: "league-of-legends",
    serviceSlug: "rank-boost",
    currency: "EUR",
    pricingModel: "RANK_STEPS",
    baseAmount: 2500,
    stepAmounts: { gold: 2500, platinum: 4000 },
    optionPricing: { priority: { type: "bps", bps: 2500 }, stream: { type: "fixed", amount: 500 } },
    modePricing: { solo: { type: "fixed", amount: 0 }, duo: { type: "bps", bps: 5000 } },
  });
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => h.getSessionUser.mockResolvedValue(CUSTOMER));

describe("authorization", () => {
  it("unauthenticated -> 401", async () => {
    h.getSessionUser.mockResolvedValue(null);
    expect((await create(body())).status).toBe(401);
  });
  it.each([BOOSTER, ADMIN])("$role -> 403", async (u) => {
    h.getSessionUser.mockResolvedValue(u);
    expect((await create(body())).status).toBe(403);
  });
  it("CUSTOMER -> 201", async () => {
    expect((await create(body())).status).toBe(201);
  });
});

describe("server-side pricing and 45/55 snapshot", () => {
  it("prices 100.00 and snapshots 45.00 platform / 55.00 booster", async () => {
    const res = await create(body());
    const { order } = await res.json();
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(order.paid).toBe(false);
    expect(order.pricing).toMatchObject({ currency: "EUR", subtotalAmount: 10000, totalAmount: 10000, taxAmount: 0, discountAmount: 0 });
    const snap = await prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(snap).toMatchObject({
      commissionBaseAmount: 10000,
      platformFeeBps: 4500,
      boosterShareBps: 5500,
      platformFeeAmount: 4500,
      boosterShareAmount: 5500,
      commissionPolicyId: "commission_policy_initial_45_55",
    });
    const db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.paymentVerifiedAt).toBeNull();
    expect(db.currency).toBe("EUR");
    expect(db.price?.toString()).toBe("100");
  });

  it("option and mode adjustments are priced on the server", async () => {
    const res = await create(body({ selectedMode: "duo", selectedOptions: ["priority"] }));
    const { order } = await res.json();
    // service 100.00, duo +50% = 50.00, priority +25% = 25.00 -> 175.00
    expect(order.pricing.totalAmount).toBe(17500);
  });

  it("the quote endpoint returns the same total without creating an order", async () => {
    const before = await prisma.order.count();
    const res = await quoteRoute(post("http://t/api/orders/quote", body()));
    expect(res.status).toBe(200);
    const { quote } = await res.json();
    expect(quote).toMatchObject({ currency: "EUR", totalAmount: 10000 });
    expect(quote).not.toHaveProperty("commission");
    expect(await prisma.order.count()).toBe(before);
  });

  it("a later commission change does not touch existing snapshots", async () => {
    const res = await create(body());
    const { order } = await res.json();
    await createCommissionPolicy(ADMIN.id, { platformFeeBps: 4000, note: "test" });
    const snap = await prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(snap.platformFeeAmount).toBe(4500);
    expect(snap.boosterShareAmount).toBe(5500);
    // New orders use the new policy.
    const res2 = await create(body());
    const snap2 = await prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: (await res2.json()).order.id } });
    expect([snap2.platformFeeAmount, snap2.boosterShareAmount]).toEqual([4000, 6000]);
    // Restore the confirmed 45/55 business rule for the remaining tests.
    await createCommissionPolicy(ADMIN.id, { platformFeeBps: 4500, note: "restore" });
  });

  it("snapshots cannot be modified afterwards", async () => {
    const { order } = await (await create(body())).json();
    // Inside a transaction: see the note in __tests__/support/pg-test-db.ts.
    await expect(
      prisma.$transaction((tx) => tx.orderPricingSnapshot.update({ where: { orderId: order.id }, data: { totalAmount: 1 } }))
    ).rejects.toThrow(/append-only/);
    const snap = await prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(snap.totalAmount).toBe(10000);
  });
});

describe("rejected input", () => {
  it("unknown catalog item -> 400", async () => {
    expect((await create(body({ serviceSlug: "nope" }))).status).toBe(400);
  });

  it("non-sellable catalog item (draft-only) -> 403 even though it is priced", async () => {
    h.checkouts[0] = { ...rankCheckout, orderCapability: "draft-only" };
    try {
      expect((await create(body())).status).toBe(403);
    } finally {
      h.checkouts[0] = rankCheckout;
    }
  });

  it("allowOrder:false -> 403", async () => {
    h.checkouts[0] = { ...rankCheckout, allowOrder: false };
    try {
      expect((await create(body())).status).toBe(403);
    } finally {
      h.checkouts[0] = rankCheckout;
    }
  });

  it.each([
    ["target below current", config({ tierId: "gold", divisionId: "i" }, { tierId: "gold", divisionId: "iv" })],
    ["unknown division", config({ tierId: "gold", divisionId: "v" }, { tierId: "gold", divisionId: "i" })],
    ["unknown tier", config({ tierId: "mythic", divisionId: "i" }, { tierId: "gold", divisionId: "i" })],
    ["division on a tier without divisions", config({ tierId: "gold", divisionId: "iv" }, { tierId: "master", divisionId: "i" })],
    ["invalid server", { ...config(), server: "mars" }],
    ["unknown field", { ...config(), price: 1 }],
  ])("invalid rank/configuration (%s) -> 400", async (_l, configuration) => {
    expect((await create(body({ configuration }))).status).toBe(400);
  });

  it("a browser-supplied price is rejected (strict schema)", async () => {
    const before = await prisma.order.count();
    for (const extra of [{ price: 1 }, { totalAmount: 1 }, { amount: 100 }, { platformFeeBps: 0 }]) {
      expect((await create(body(extra))).status).toBe(400);
    }
    expect(await prisma.order.count()).toBe(before);
  });

  it("a manipulated expected total -> 409", async () => {
    expect((await create(body({ expectedTotal: { amount: 100, currency: "EUR" } }))).status).toBe(409);
  });

  it("a matching expected total is accepted", async () => {
    expect((await create(body({ expectedTotal: { amount: 10000, currency: "EUR" } }))).status).toBe(201);
  });

  it("incorrect currency -> 409", async () => {
    expect((await create(body({ expectedTotal: { amount: 10000, currency: "USD" } }))).status).toBe(409);
  });

  it("an unpriced option is not purchasable -> 403", async () => {
    expect((await create(body({ selectedOptions: ["unpriced"] }))).status).toBe(403);
  });

  it("a rank range crossing an unpriced tier is not purchasable -> 403", async () => {
    // Gold IV -> Diamond IV needs steps that start in Emerald, which has no price.
    const res = await create(body({ configuration: config({ tierId: "gold", divisionId: "iv" }, { tierId: "diamond", divisionId: "iv" }) }));
    expect(res.status).toBe(403);
  });

  it("an option not offered in the chosen mode -> 400", async () => {
    expect((await create(body({ selectedMode: "duo", selectedOptions: ["stream"] }))).status).toBe(400);
  });

  it("missing Idempotency-Key -> 400", async () => {
    expect((await create(body(), null)).status).toBe(400);
  });
});

describe("duplicate submissions", () => {
  it("the same Idempotency-Key returns the same order once", async () => {
    const key = uid("dup-key-0000000");
    const r1 = await create(body(), key);
    const r2 = await create(body(), key);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    const [a, b] = [(await r1.json()).order.id, (await r2.json()).order.id];
    expect(a).toBe(b);
    expect(await prisma.order.count({ where: { creationIdempotencyKey: key } })).toBe(1);
  });

  it("concurrent duplicates still create one order", async () => {
    const key = uid("race-key-000000");
    const results = await Promise.all([create(body(), key), create(body(), key), create(body(), key)]);
    const ids = new Set(await Promise.all(results.map(async (r) => (await r.json()).order.id)));
    expect(ids.size).toBe(1);
    expect(await prisma.order.count({ where: { creationIdempotencyKey: key } })).toBe(1);
  });

  it("reusing a key for a different order -> 409", async () => {
    const key = uid("reuse-key-00000");
    expect((await create(body(), key)).status).toBe(201);
    expect((await create(body({ selectedOptions: ["priority"] }), key)).status).toBe(409);
  });
});

describe("marketplace", () => {
  it("a newly created (unpaid) order is never listed to boosters", async () => {
    const { order } = await (await create(body())).json();
    const listed = await getAvailableOrders();
    expect(listed.map((o: any) => o.id)).not.toContain(order.id);
  });
});
