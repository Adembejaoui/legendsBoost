/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake DB plumbing */
/**
 * Phase 1: order marketplace safety.
 *
 * Exercises the real services and route handlers against a small in-memory
 * fake of the Prisma client that reproduces the two database behaviours the
 * safety rules rely on:
 *   - conditional updates (`where: { id, status, paymentVerifiedAt }`) throw
 *     P2025 when the row no longer matches;
 *   - the unique `activeOrderId` index throws P2002 on a second active
 *     assignment for the same order.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const ACTIVE = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"];
  const db = {
    users: new Map<string, any>(),
    orders: new Map<string, any>(),
    assignments: [] as any[],
    events: [] as any[],
  };
  const prismaErr = (code: string) => Object.assign(new Error(code), { code });
  const matchStatus = (cond: any, v: string) =>
    cond === undefined ? true : typeof cond === "string" ? v === cond : cond.in ? cond.in.includes(v) : true;
  const matchPaid = (cond: any, v: unknown) =>
    cond === undefined ? true : cond.not === null ? v !== null && v !== undefined : true;
  const activeFor = (orderId: string) => db.assignments.filter((a) => a.orderId === orderId && ACTIVE.includes(a.status));

  const client: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => db.users.get(where.id) ?? null),
      findMany: vi.fn(async () => [...db.users.values()].filter((u) => u.role === "ADMIN")),
    },
    order: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const o = db.orders.get(where.id);
        if (!o) return null;
        const row: any = { ...o };
        if (include?.assignments) {
          row.assignments = db.assignments.filter(
            (a) => a.orderId === o.id && matchStatus(include.assignments.where?.status, a.status)
          );
        }
        if (include?.events) row.events = db.events.filter((e) => e.orderId === o.id);
        return row;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        [...db.orders.values()]
          .filter(
            (o) =>
              matchStatus(where.status, o.status) &&
              matchPaid(where.paymentVerifiedAt, o.paymentVerifiedAt) &&
              (where.gameSlug ? o.gameSlug === where.gameSlug : true) &&
              !(where.assignments?.none && activeFor(o.id).length > 0) &&
              (where.biddingClosesAt?.lte === undefined || (o.biddingClosesAt && o.biddingClosesAt <= where.biddingClosesAt.lte))
          )
          .map((o) => ({ ...o, assignments: activeFor(o.id), user: { id: o.userId, name: "Customer" } }))
      ),
      create: vi.fn(async ({ data }: any) => {
        const o = { id: `order-new-${db.orders.size + 1}`, paymentVerifiedAt: null, createdAt: new Date(), ...data };
        db.orders.set(o.id, o);
        return { ...o };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ ...db.orders.get(where.id), pricingSnapshot: null })),
      update: vi.fn(async ({ where, data }: any) => {
        const o = db.orders.get(where.id);
        if (!o || !matchStatus(where.status, o.status) || !matchPaid(where.paymentVerifiedAt, o.paymentVerifiedAt)) {
          throw prismaErr("P2025");
        }
        Object.assign(o, data);
        return { ...o };
      }),
    },
    orderPricingSnapshot: { create: vi.fn(async ({ data }: any) => ({ id: "snap", ...data })) },
    boosterProfile: {
      updateMany: vi.fn(async ({ where }: any) => {
        const p = db.users.get(where.userId)?.boosterProfile;
        return { count: p && (!where.verificationStatus || p.verificationStatus === where.verificationStatus) ? 1 : 0 };
      }),
    },
    boosterEarning: { findUnique: vi.fn(async () => null) },
    orderBid: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    payment: { findUnique: vi.fn(async () => null), update: vi.fn(async ({ data }: any) => data) },
    orderBoosterAssignment: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          db.assignments.find(
            (a) =>
              a.orderId === where.orderId &&
              matchStatus(where.status, a.status) &&
              (where.boosterId === undefined || a.boosterId === where.boosterId)
          ) ?? null
      ),
      count: vi.fn(
        async ({ where }: any) =>
          db.assignments.filter((a) => (where.boosterId === undefined || a.boosterId === where.boosterId) && matchStatus(where.status, a.status)).length
      ),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const a = db.assignments.find((x) => x.id === where.id);
        if (!a) return null;
        return include?.order ? { ...a, order: { ...db.orders.get(a.orderId) } } : { ...a };
      }),
      create: vi.fn(async ({ data }: any) => {
        if (data.activeOrderId && db.assignments.some((a) => a.activeOrderId === data.activeOrderId)) {
          throw prismaErr("P2002");
        }
        const a = { id: `as-new-${db.assignments.length + 1}`, assignedAt: new Date(), ...data };
        db.assignments.push(a);
        return { ...a };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const a = db.assignments.find((x) => x.id === where.id);
        if (!a) throw prismaErr("P2025");
        Object.assign(a, data);
        return { ...a };
      }),
    },
    boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) },
    orderEvent: {
      create: vi.fn(async ({ data }: any) => {
        const e = { id: `ev-${db.events.length + 1}`, createdAt: new Date(), ...data };
        db.events.push(e);
        return e;
      }),
    },
  };
  client.$transaction = vi.fn(async (cb: any) => cb(client));

  return {
    db,
    client,
    getSessionUser: vi.fn(),
    offers: [] as any[],
    checkouts: [] as any[],
  };
});

vi.mock("@/lib/prisma", () => ({ default: h.client }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({
  revokeOrderAccess: vi.fn(),
  broadcastToOrder: vi.fn(),
  broadcastToUser: vi.fn(),
}));
// Catalog modules are replaced by a mutable registry so each test controls
// the flags. The real catalog is checked separately via vi.importActual.
vi.mock("@/lib/catalog/game-services", () => ({
  getGameServiceOffer: (g: string, s: string) => h.offers.find((o) => o.gameSlug === g && o.serviceSlug === s),
}));
vi.mock("@/lib/config/checkout-options", () => ({
  getCheckoutConfig: (g: string, s: string) => h.checkouts.find((c) => c.gameSlug === g && c.serviceSlug === s),
}));

// Earnings allocation and the payments outbox are covered by the
// Postgres-backed tests in __tests__/payments; mocked here because this
// file's Prisma mock has no financial tables.
// Order creation now requires a server price: keep the real catalog gate,
// replace only the database price lookup (see the support module).
vi.mock("@/lib/pricing/service", async (orig) =>
  (await import("../support/fixed-quote-pricing")).withFixedQuote(await orig())
);
vi.mock("@/lib/finance/earnings", () => ({ allocateOnCompletion: vi.fn(async () => ({ outcome: "no_reservation" })) }));
vi.mock("@/lib/payments/outbox", () => ({ dispatchOutbox: vi.fn(async () => ({ done: 0, failed: 0 })), enqueueOutbox: vi.fn(async () => {}) }));
import { POST as createOrder } from "@/app/api/orders/route";
import { GET as getOrder } from "@/app/api/orders/[orderId]/route";
import { POST as cancelRoute } from "@/app/api/booster/orders/[orderId]/cancel/route";
import { POST as abandonRoute } from "@/app/api/booster/orders/[orderId]/abandon/route";
import { POST as republishRoute } from "@/app/api/admin/orders/[orderId]/republish/route";
import {
  abandonOrder,
  cancelAssignment,
  claimOrder,
  getAvailableOrders,
  isOrderClaimable,
} from "@/lib/assignments/service";
import { BoosterCancellationForbiddenError, OrderAlreadyClaimedError, OrderNotClaimableError } from "@/lib/assignments/types";
import { republishDraftOrder } from "@/lib/orders/draft-admin.service";
import { evaluateOrderEligibility, NOT_PURCHASABLE_MESSAGE } from "@/lib/orders/order-eligibility";
import { resolveWorkspaceAccess } from "@/lib/orders/workspace-access";

// ---------------------------------------------------------------- fixtures

const CUSTOMER = { id: "cust-1", role: "CUSTOMER" };
const TEST_GAME_PERMISSIONS = [{ gameSlug: "test-game", rankSystemId: "none", maxTargetRankValue: 0, regions: [], serviceSlugs: [] }];
const BOOSTER_A = { id: "booster-a", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED", permissions: TEST_GAME_PERMISSIONS } };
const BOOSTER_B = { id: "booster-b", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED", permissions: TEST_GAME_PERMISSIONS } };
const ADMIN = { id: "admin-1", role: "ADMIN" };
const PAID_AT = new Date("2026-11-01T00:00:00Z");

const liveOffer = (o: Record<string, unknown> = {}) => ({
  gameSlug: "test-game",
  serviceSlug: "test-boost",
  title: "Test boost",
  description: "",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
  fields: [],
  ...o,
});
const liveCheckout = (o: Record<string, unknown> = {}) => ({
  gameSlug: "test-game",
  serviceSlug: "test-boost",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
  allowOrder: true,
  options: [],
  ...o,
});

function seedOrder(o: Record<string, unknown>) {
  const order = {
    userId: CUSTOMER.id,
    gameSlug: "test-game",
    serviceSlug: "test-boost",
    configuration: {},
    selectedOptions: [],
    selectedMode: null,
    price: null,
    currency: null,
    paymentVerifiedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...o,
  } as any;
  h.db.orders.set(order.id, order);
  return order;
}

function seedAssignment(a: Record<string, unknown>) {
  const row = { assignedById: a.boosterId, assignedAt: new Date(), startedAt: new Date(), ...a } as any;
  h.db.assignments.push(row);
  return row;
}

const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) });
let keySeq = 0;
const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    // Order creation requires an Idempotency-Key (other routes ignore it).
    headers: { "Content-Type": "application/json", "Idempotency-Key": `safety-test-key-${++keySeq}-000000` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const orderBody = { gameSlug: "test-game", serviceSlug: "test-boost", configuration: {}, riskAccepted: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.db.users.clear();
  h.db.orders.clear();
  h.db.assignments.length = 0;
  h.db.events.length = 0;
  for (const u of [CUSTOMER, BOOSTER_A, BOOSTER_B, ADMIN]) h.db.users.set(u.id, u);
  h.offers.length = 0;
  h.checkouts.length = 0;
  h.offers.push(liveOffer());
  h.checkouts.push(liveCheckout());
  h.getSessionUser.mockResolvedValue(CUSTOMER);
});

// ------------------------------------------------- catalog eligibility gate

describe("server-side catalog eligibility", () => {
  it("allows only a fully live, approved, allowOrder:true service", () => {
    expect(evaluateOrderEligibility(liveOffer() as any, liveCheckout() as any).ok).toBe(true);
  });

  it.each([
    ["checkout allowOrder: false", {}, { allowOrder: false }],
    ["checkout allowOrder missing", {}, { allowOrder: undefined }],
    ["checkout draft-only", {}, { orderCapability: "draft-only" }],
    ["checkout request-only", {}, { orderCapability: "request-only" }],
    ["checkout pending-review", {}, { availability: "pending-review" }],
    ["checkout compliance pending", {}, { complianceStatus: "pending-review" }],
    ["offer draft-only", { orderCapability: "draft-only" }, {}],
    ["offer pending-review", { availability: "pending-review" }, {}],
    ["offer compliance rejected", { complianceStatus: "rejected" }, {}],
  ])("denies %s", (_label, offerPatch, checkoutPatch) => {
    const result = evaluateOrderEligibility(liveOffer(offerPatch) as any, liveCheckout(checkoutPatch) as any);
    expect(result).toEqual({ ok: false, status: 403, reason: NOT_PURCHASABLE_MESSAGE });
  });

  it("denies a service with no checkout configuration (deny by default)", () => {
    expect(evaluateOrderEligibility(liveOffer() as any, undefined)).toMatchObject({ ok: false, status: 403 });
  });

  it("compliance pending blocks real sales; only Stripe TEST mode waives it", () => {
    expect(evaluateOrderEligibility(liveOffer({ complianceStatus: "pending-review" }) as any, liveCheckout() as any, "live").ok).toBe(false);
    expect(evaluateOrderEligibility(liveOffer({ complianceStatus: "pending-review" }) as any, liveCheckout() as any, "unconfigured").ok).toBe(false);
    expect(evaluateOrderEligibility(liveOffer({ complianceStatus: "pending-review" }) as any, liveCheckout() as any, "test")).toMatchObject({
      ok: true,
      complianceWaivedForTestMode: true,
    });
    expect(evaluateOrderEligibility(liveOffer({ complianceStatus: "rejected" }) as any, liveCheckout() as any, "test").ok).toBe(false);
    expect(evaluateOrderEligibility(liveOffer({ orderCapability: "draft-only" }) as any, liveCheckout() as any, "test").ok).toBe(false);
  });

  it("no service in the real catalog can be sold for real money today (compliance not approved)", async () => {
    const { gameServices } = await vi.importActual<typeof import("@/lib/catalog/game-services")>(
      "@/lib/catalog/game-services"
    );
    const { checkoutConfigs } = await vi.importActual<typeof import("@/lib/config/checkout-options")>(
      "@/lib/config/checkout-options"
    );
    expect(gameServices.length).toBeGreaterThan(0);
    for (const offer of gameServices) {
      const checkout = checkoutConfigs.find(
        (c) => c.gameSlug === offer.gameSlug && c.serviceSlug === offer.serviceSlug
      );
      expect(evaluateOrderEligibility(offer, checkout, "live").ok, `${offer.gameSlug}/${offer.serviceSlug}`).toBe(false);
      expect(offer.complianceStatus).not.toBe("approved");
    }
  });
});

describe("POST /api/orders", () => {
  it("catalog allowOrder: false blocks creation", async () => {
    h.checkouts[0] = liveCheckout({ allowOrder: false });
    const res = await createOrder(post("http://localhost/api/orders", orderBody));
    expect(res.status).toBe(403);
    expect(h.client.order.create).not.toHaveBeenCalled();
    expect(h.db.orders.size).toBe(0);
  });

  it("draft-only services cannot be purchased", async () => {
    h.offers[0] = liveOffer({ orderCapability: "draft-only", complianceStatus: "pending-review" });
    h.checkouts[0] = liveCheckout({ orderCapability: "draft-only" });
    const res = await createOrder(post("http://localhost/api/orders", orderBody));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: NOT_PURCHASABLE_MESSAGE });
    expect(h.client.order.create).not.toHaveBeenCalled();
  });

  it("unknown services are rejected", async () => {
    const res = await createOrder(post("http://localhost/api/orders", { ...orderBody, serviceSlug: "nope" }));
    expect(res.status).toBe(400);
    expect(h.client.order.create).not.toHaveBeenCalled();
  });

  it("a new order is created AWAITING_PAYMENT, never PENDING, with no payment marker", async () => {
    const res = await createOrder(post("http://localhost/api/orders", orderBody));
    expect(res.status).toBe(201);
    const data = (h.client.order.create.mock.calls[0][0] as any).data;
    expect(data.status).toBe("AWAITING_PAYMENT");
    expect(data).not.toHaveProperty("paymentVerifiedAt");
  });
});

// ------------------------------------------------------ marketplace gate

describe("unpaid orders never reach the marketplace", () => {
  it("a new unpaid order does not appear in the marketplace and cannot be claimed", async () => {
    const res = await createOrder(post("http://localhost/api/orders", orderBody));
    const { order } = await res.json();

    expect(await getAvailableOrders()).toEqual([]);
    await expect(claimOrder(order.id, BOOSTER_A.id)).rejects.toBeInstanceOf(OrderNotClaimableError);
    expect(h.db.assignments).toHaveLength(0);
    expect(h.db.orders.get(order.id).status).toBe("AWAITING_PAYMENT");
  });

  it("a legacy PENDING order without verified payment is hidden and unclaimable", async () => {
    seedOrder({ id: "legacy-pending", status: "PENDING" });

    expect(await getAvailableOrders()).toEqual([]);
    expect(isOrderClaimable({ status: "PENDING", assignments: [], paymentVerifiedAt: null })).toBe(false);
    await expect(claimOrder("legacy-pending", BOOSTER_A.id)).rejects.toThrow(/payment has not been verified/);
    expect(h.db.assignments).toHaveLength(0);
    expect(h.db.orders.get("legacy-pending").status).toBe("PENDING"); // not silently converted
  });

  it("the marketplace query itself excludes unpaid orders", async () => {
    await getAvailableOrders();
    expect((h.client.order.findMany.mock.calls[0][0] as any).where).toMatchObject({
      status: "PENDING",
      paymentVerifiedAt: { not: null },
    });
  });

  it("defence in depth: an unpaid row returned by the query is still filtered out", async () => {
    h.client.order.findMany.mockResolvedValueOnce([
      { id: "x", status: "PENDING", paymentVerifiedAt: null, assignments: [] },
      { id: "y", status: "PENDING", paymentVerifiedAt: PAID_AT, assignments: [] },
    ]);
    expect((await getAvailableOrders()).map((o: any) => o.id)).toEqual(["y"]);
  });

  it("a PENDING order with a verified payment is listed (the gate is not a blanket block)", async () => {
    seedOrder({ id: "paid", status: "PENDING", paymentVerifiedAt: PAID_AT });
    expect((await getAvailableOrders()).map((o: any) => o.id)).toEqual(["paid"]);
  });
});

describe("atomic claiming is preserved", () => {
  it("two boosters cannot claim the same (paid) order", async () => {
    seedOrder({ id: "paid", status: "PENDING", paymentVerifiedAt: PAID_AT });

    const results = await Promise.allSettled([
      claimOrder("paid", BOOSTER_A.id),
      claimOrder("paid", BOOSTER_B.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OrderAlreadyClaimedError);
    expect(h.db.assignments.filter((a) => a.activeOrderId === "paid")).toHaveLength(1);
    // Taken, not started yet (the booster starts it).
    expect(h.db.orders.get("paid").status).toBe("CLAIMED");
  });

  it("the claim's conditional update requires PENDING and a verified payment in one statement", async () => {
    seedOrder({ id: "paid", status: "PENDING", paymentVerifiedAt: PAID_AT });
    await claimOrder("paid", BOOSTER_A.id);
    expect(h.client.order.update).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "paid", status: "PENDING", paymentVerifiedAt: { not: null } }),
      data: expect.objectContaining({ status: "CLAIMED", claimedAt: expect.any(Date) }),
    });
  });
});

// --------------------------------------------- booster cancel / abandon

describe("boosters cannot cancel customer orders", () => {
  beforeEach(() => {
    seedOrder({ id: "o-1", status: "IN_PROGRESS" });
    seedAssignment({ id: "as-1", orderId: "o-1", boosterId: BOOSTER_A.id, status: "IN_PROGRESS", activeOrderId: "o-1" });
  });

  it("the cancel route returns 403 for the assigned booster and changes nothing", async () => {
    h.getSessionUser.mockResolvedValue(BOOSTER_A);
    const res = await cancelRoute(
      post("http://localhost/api/booster/orders/o-1/cancel", { assignmentId: "as-1", reason: "done" }),
      params("o-1")
    );
    expect(res.status).toBe(403);
    expect(h.db.orders.get("o-1").status).toBe("IN_PROGRESS");
    expect(h.db.assignments[0].status).toBe("IN_PROGRESS");
    expect(h.client.order.update).not.toHaveBeenCalled();
  });

  it("the service also refuses a booster, even if a route forgot to check", async () => {
    await expect(cancelAssignment("as-1", BOOSTER_A.id, "BOOSTER", "x")).rejects.toBeInstanceOf(
      BoosterCancellationForbiddenError
    );
    expect(h.db.orders.get("o-1").status).toBe("IN_PROGRESS");
  });

  it("customers cannot use the cancel route either", async () => {
    h.getSessionUser.mockResolvedValue(CUSTOMER);
    const res = await cancelRoute(post("http://localhost/x", { assignmentId: "as-1" }), params("o-1"));
    expect(res.status).toBe(403);
  });

  it("an admin can still cancel", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN);
    const res = await cancelRoute(
      post("http://localhost/api/booster/orders/o-1/cancel", { assignmentId: "as-1", reason: "customer request" }),
      params("o-1")
    );
    expect(res.status).toBe(200);
    expect(h.db.orders.get("o-1").status).toBe("CANCELLED");
  });

  it("the booster can still abandon through the approved workflow (-> DRAFT, history kept)", async () => {
    h.getSessionUser.mockResolvedValue(BOOSTER_A);
    const res = await abandonRoute(
      post("http://localhost/api/booster/orders/o-1/abandon", { assignmentId: "as-1", reason: "Cannot continue" }),
      params("o-1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ orderStatus: "DRAFT" });

    expect(h.db.orders.get("o-1").status).toBe("DRAFT");
    const assignment = h.db.assignments[0];
    expect(assignment).toMatchObject({ status: "RELEASED", activeOrderId: null, endReason: "ABANDONED: Cannot continue" });
    expect(assignment.endedAt).toBeInstanceOf(Date);
    expect(h.db.assignments).toHaveLength(1); // history row kept, not deleted
    const abandoned = h.db.events.find((e) => e.type === "BOOSTER_ABANDONED");
    expect(abandoned?.metadata).toMatchObject({ boosterId: BOOSTER_A.id, reason: "Cannot continue", previousStatus: "IN_PROGRESS" });
  });

  it("an abandoned order stays out of the marketplace", async () => {
    await abandonOrder("as-1", BOOSTER_A.id, "Cannot continue");
    expect(await getAvailableOrders()).toEqual([]);
  });
});

// ------------------------------------------------------- admin republish

describe("admin republish cannot bypass payment", () => {
  beforeEach(() => {
    seedOrder({ id: "d-1", status: "DRAFT" });
  });

  it("the service rejects an unpaid draft with 409 and leaves it DRAFT", async () => {
    await expect(republishDraftOrder("d-1", ADMIN.id)).rejects.toMatchObject({ status: 409 });
    expect(h.db.orders.get("d-1").status).toBe("DRAFT");
    expect(h.client.order.update).not.toHaveBeenCalled();
  });

  it("the route returns 409 to an admin for an unpaid draft", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN);
    const res = await republishRoute(post("http://localhost/api/admin/orders/d-1/republish", { confirm: true }), params("d-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no verified payment/);
    expect(h.db.orders.get("d-1").status).toBe("DRAFT");
  });

  it("a paid draft can still be republished", async () => {
    h.db.orders.get("d-1").paymentVerifiedAt = PAID_AT;
    const out = await republishDraftOrder("d-1", ADMIN.id);
    expect(out.status).toBe("PENDING");
    expect((await getAvailableOrders()).map((o: any) => o.id)).toEqual(["d-1"]);
  });
});

// ------------------------------------------------------- legacy readability

describe("existing completed and in-progress orders remain readable", () => {
  beforeEach(() => {
    seedOrder({ id: "legacy-done", status: "COMPLETED", completedAt: new Date("2026-10-10T00:00:00Z") });
    seedOrder({ id: "legacy-wip", status: "IN_PROGRESS" });
    seedAssignment({ id: "as-done", orderId: "legacy-done", boosterId: BOOSTER_A.id, status: "COMPLETED", activeOrderId: null });
    seedAssignment({ id: "as-wip", orderId: "legacy-wip", boosterId: BOOSTER_A.id, status: "IN_PROGRESS", activeOrderId: "legacy-wip" });
  });

  it.each(["legacy-done", "legacy-wip"])("the customer can still read %s", async (id) => {
    const res = await getOrder(new Request(`http://localhost/api/orders/${id}`) as unknown as NextRequest, params(id));
    expect(res.status).toBe(200);
    const { order } = await res.json();
    expect(order.id).toBe(id);
    expect(order.paymentVerifiedAt).toBeNull();
  });

  it("workspace access is unchanged for legacy orders", () => {
    const shape = (id: string) => ({
      ...h.db.orders.get(id),
      assignments: h.db.assignments.filter((a) => a.orderId === id),
    });
    expect(resolveWorkspaceAccess(CUSTOMER, shape("legacy-done"))?.viewerRole).toBe("customer");
    expect(resolveWorkspaceAccess(CUSTOMER, shape("legacy-wip"))?.viewerRole).toBe("customer");
    expect(resolveWorkspaceAccess(BOOSTER_A, shape("legacy-wip"))?.canManageAssignment).toBe(true);
    expect(resolveWorkspaceAccess(BOOSTER_A, shape("legacy-done"))).not.toBeNull();
  });
});
