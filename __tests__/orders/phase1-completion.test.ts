/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 1 completion: role-restricted order creation, customer cancellation
 * of unpaid orders, admin DRAFT cancellation with a mandatory reason, and
 * "no path can publish an unpaid order".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
}));

vi.mock("@/lib/prisma", async () => ({ default: (await import("./support/fake-order-db")).fake.client }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({
  revokeOrderAccess: vi.fn(),
  broadcastToOrder: vi.fn(),
  broadcastToUser: vi.fn(),
}));
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
import { fake, TEST_GAME_PERMISSIONS } from "./support/fake-order-db";
import { POST as createOrder } from "@/app/api/orders/route";
import { POST as customerCancelRoute } from "@/app/api/orders/[orderId]/cancel/route";
import { POST as adminCancelRoute } from "@/app/api/admin/orders/[orderId]/cancel/route";
import { POST as republishRoute } from "@/app/api/admin/orders/[orderId]/republish/route";
import {
  abandonOrder,
  claimOrder,
  getAvailableOrders,
  reassignOrder,
  releaseAssignment,
} from "@/lib/assignments/service";
import { cancelOrderByCustomer, getCustomerCancelEligibility } from "@/lib/orders/cancellation.service";
import { cancelDraftOrder, republishDraftOrder } from "@/lib/orders/draft-admin.service";
import { createNotificationsForEvent } from "@/lib/notifications/service";

const CUSTOMER = { id: "cust-1", role: "CUSTOMER" };
const OTHER_CUSTOMER = { id: "cust-2", role: "CUSTOMER" };
const BOOSTER = { id: "booster-a", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED", permissions: TEST_GAME_PERMISSIONS } };
const BOOSTER_B = { id: "booster-b", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED", permissions: TEST_GAME_PERMISSIONS } };
const ADMIN = { id: "admin-1", role: "ADMIN" };
const PAID_AT = new Date("2026-11-01T00:00:00Z");

const live = {
  gameSlug: "test-game",
  serviceSlug: "test-boost",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
};

const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) });
let keySeq = 0;
const post = (body: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    // Order creation requires an Idempotency-Key (other routes ignore it).
    headers: { "Content-Type": "application/json", "Idempotency-Key": `phase1-test-key-${++keySeq}-000000` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const status = (id: string) => fake.db.orders.get(id)?.status;

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset([CUSTOMER, OTHER_CUSTOMER, BOOSTER, BOOSTER_B, ADMIN]);
  h.offers.length = 0;
  h.checkouts.length = 0;
  h.offers.push({ ...live, title: "Test", description: "", fields: [] });
  h.checkouts.push({ ...live, allowOrder: true, options: [] });
  h.getSessionUser.mockResolvedValue(CUSTOMER);
});

// ---------------------------------------------------------------- creation

describe("order creation is restricted to CUSTOMER accounts", () => {
  const body = { gameSlug: "test-game", serviceSlug: "test-boost", configuration: {}, riskAccepted: true };

  it.each([BOOSTER, ADMIN])("$role cannot create an order, even for a purchasable service", async (user) => {
    h.getSessionUser.mockResolvedValue(user);
    const res = await createOrder(post(body));
    expect(res.status).toBe(403);
    expect(fake.client.order.create).not.toHaveBeenCalled();
  });

  it("unauthenticated requests get 401", async () => {
    h.getSessionUser.mockResolvedValue(null);
    expect((await createOrder(post(body))).status).toBe(401);
  });

  it("a customer can create (AWAITING_PAYMENT) when the service is purchasable", async () => {
    const res = await createOrder(post(body));
    expect(res.status).toBe(201);
    expect((await res.json()).order.status).toBe("AWAITING_PAYMENT");
  });
});

// ------------------------------------------------------ customer cancellation

describe("customer cancellation of unpaid orders", () => {
  it("customers cannot cancel: the endpoint is disabled (pause only)", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    const res = await customerCancelRoute(post({ reason: "Changed my mind" }), params("o-1"));
    expect(res.status).toBe(403);
    expect(status("o-1")).toBe("AWAITING_PAYMENT");
  });

  it("the cancellation service still cancels an AWAITING_PAYMENT order (audited, idempotent notification)", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    await cancelOrderByCustomer("o-1", CUSTOMER.id, "Changed my mind");
    expect(status("o-1")).toBe("CANCELLED");

    const ev = fake.db.events.find((e) => e.type === "ORDER_CANCELLED");
    expect(ev).toMatchObject({
      message: "Changed my mind",
      metadata: { actorUserId: CUSTOMER.id, cancelledBy: "CUSTOMER", previousStatus: "AWAITING_PAYMENT", reason: "Changed my mind" },
    });
    expect(vi.mocked(createNotificationsForEvent).mock.calls[0][0]).toMatchObject({
      type: "ORDER_CANCELLED",
      dedupeKey: "ORDER_CANCELLED:o-1",
    });
  });

  it("the owner can cancel a legacy unpaid PENDING order with no booster", async () => {
    fake.seedOrder({ id: "o-1", status: "PENDING" });
    await cancelOrderByCustomer("o-1", CUSTOMER.id);
    expect(status("o-1")).toBe("CANCELLED");
  });

  it("the write is conditional on still unpaid and owned", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    await cancelOrderByCustomer("o-1", CUSTOMER.id);
    expect(fake.client.order.update).toHaveBeenCalledWith({
      where: { id: "o-1", userId: CUSTOMER.id, status: { in: ["AWAITING_PAYMENT", "PENDING"] }, paymentVerifiedAt: null },
      data: { status: "CANCELLED" },
    });
  });

  it("another customer is refused and the order is untouched", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    h.getSessionUser.mockResolvedValue(OTHER_CUSTOMER);
    expect((await customerCancelRoute(post({}), params("o-1"))).status).toBe(403);
    expect(status("o-1")).toBe("AWAITING_PAYMENT");
  });

  it("an unknown order is refused", async () => {
    expect((await customerCancelRoute(post({}), params("nope"))).status).toBe(403);
  });

  it.each([BOOSTER, ADMIN])("$role cannot use the customer cancel endpoint", async (user) => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    h.getSessionUser.mockResolvedValue(user);
    expect((await customerCancelRoute(post({}), params("o-1"))).status).toBe(403);
    expect(status("o-1")).toBe("AWAITING_PAYMENT");
  });

  it("the service re-checks the role from the database", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT", userId: BOOSTER.id });
    await expect(cancelOrderByCustomer("o-1", BOOSTER.id)).rejects.toMatchObject({ status: 403 });
  });

  it("unauthenticated requests get 401", async () => {
    h.getSessionUser.mockResolvedValue(null);
    expect((await customerCancelRoute(post({}), params("o-1"))).status).toBe(401);
  });

  it("rejects unknown body fields and over-long reasons", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    expect((await customerCancelRoute(post({ status: "PENDING" }), params("o-1"))).status).toBe(403);
    expect((await customerCancelRoute(post({ reason: "x".repeat(501) }), params("o-1"))).status).toBe(403);
    expect(status("o-1")).toBe("AWAITING_PAYMENT");
  });

  it.each([
    ["a paid PENDING order", { status: "PENDING", paymentVerifiedAt: PAID_AT }],
    ["IN_PROGRESS", { status: "IN_PROGRESS" }],
    ["PAUSED", { status: "PAUSED" }],
    ["DRAFT", { status: "DRAFT" }],
    ["COMPLETED", { status: "COMPLETED" }],
    ["CANCELLED", { status: "CANCELLED" }],
  ])("refuses %s (customer cancel disabled) and leaves it unchanged", async (_label, patch) => {
    fake.seedOrder({ id: "o-1", ...patch });
    const res = await customerCancelRoute(post({}), params("o-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
    expect(status("o-1")).toBe(patch.status);
    expect(fake.client.order.update).not.toHaveBeenCalled();
  });

  it("refuses when an active booster assignment exists", () => {
    expect(
      getCustomerCancelEligibility({ status: "PENDING", paymentVerifiedAt: null, assignments: [{ status: "IN_PROGRESS" }] }).ok
    ).toBe(false);
    expect(
      getCustomerCancelEligibility({ status: "PENDING", paymentVerifiedAt: null, assignments: [{ status: "RELEASED" }] }).ok
    ).toBe(true);
  });

  it("a payment verified between the read and the write wins (409, not cancelled)", async () => {
    fake.seedOrder({ id: "o-1", status: "AWAITING_PAYMENT" });
    // The read sees the order unpaid; by the time of the write it is paid.
    fake.client.order.findUnique.mockImplementationOnce(async () => {
      const snapshot = { ...fake.db.orders.get("o-1"), assignments: [] };
      fake.db.orders.get("o-1").paymentVerifiedAt = PAID_AT;
      return snapshot;
    });
    await expect(cancelOrderByCustomer("o-1", CUSTOMER.id)).rejects.toMatchObject({ status: 409 });
    expect(status("o-1")).toBe("AWAITING_PAYMENT");
  });

  it("a cancelled order never reaches the marketplace", async () => {
    fake.seedOrder({ id: "o-1", status: "PENDING" });
    await cancelOrderByCustomer("o-1", CUSTOMER.id);
    expect(await getAvailableOrders()).toEqual([]);
    await expect(claimOrder("o-1", BOOSTER.id)).rejects.toThrow(/expected PENDING/);
  });
});

// --------------------------------------------------- admin DRAFT cancellation

describe("admin cancellation of DRAFT orders (reason required)", () => {
  beforeEach(() => {
    fake.seedOrder({ id: "d-1", status: "IN_PROGRESS" });
    fake.seedAssignment({ id: "as-1", orderId: "d-1", boosterId: BOOSTER.id, status: "IN_PROGRESS", activeOrderId: "d-1" });
  });

  async function abandoned() {
    await abandonOrder("as-1", BOOSTER.id, "Cannot continue");
    expect(status("d-1")).toBe("DRAFT");
  }

  it("admin cancels an abandoned draft with a reason; assignment history is preserved", async () => {
    await abandoned();
    h.getSessionUser.mockResolvedValue(ADMIN);
    const res = await adminCancelRoute(post({ confirm: true, reason: "Customer unreachable" }), params("d-1"));
    expect(res.status).toBe(200);
    expect(status("d-1")).toBe("CANCELLED");

    const ev = fake.db.events.find((e) => e.type === "ORDER_CANCELLED");
    expect(ev).toMatchObject({
      message: "Customer unreachable",
      metadata: { actorUserId: ADMIN.id, cancelledBy: "ADMIN", previousStatus: "DRAFT", reason: "Customer unreachable" },
    });
    // The abandonment record is untouched.
    expect(fake.db.assignments).toHaveLength(1);
    expect(fake.db.assignments[0]).toMatchObject({ status: "RELEASED", endReason: "ABANDONED: Cannot continue" });
    expect(fake.db.events.some((e) => e.type === "BOOSTER_ABANDONED")).toBe(true);
  });

  it.each([
    ["missing", { confirm: true }],
    ["blank", { confirm: true, reason: "   " }],
    ["too short", { confirm: true, reason: "no" }],
    ["too long", { confirm: true, reason: "x".repeat(501) }],
  ])("a %s reason is rejected with 400", async (_label, body) => {
    await abandoned();
    h.getSessionUser.mockResolvedValue(ADMIN);
    expect((await adminCancelRoute(post(body), params("d-1"))).status).toBe(400);
    expect(status("d-1")).toBe("DRAFT");
  });

  it("explicit confirmation is required", async () => {
    await abandoned();
    h.getSessionUser.mockResolvedValue(ADMIN);
    const res = await adminCancelRoute(post({ reason: "Customer unreachable" }), params("d-1"));
    expect(res.status).toBe(400);
    expect(status("d-1")).toBe("DRAFT");
  });

  it("the service enforces the reason even without the route", async () => {
    await abandoned();
    await expect(cancelDraftOrder("d-1", ADMIN.id, "  ")).rejects.toMatchObject({ status: 400 });
  });

  it.each([CUSTOMER, BOOSTER])("$role cannot cancel a draft", async (user) => {
    await abandoned();
    h.getSessionUser.mockResolvedValue(user);
    expect((await adminCancelRoute(post({ confirm: true, reason: "abc def" }), params("d-1"))).status).toBe(403);
    await expect(cancelDraftOrder("d-1", user.id, "abc def")).rejects.toMatchObject({ status: 403 });
    expect(status("d-1")).toBe("DRAFT");
  });

  it("only DRAFT orders can be cancelled through this endpoint", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN);
    expect((await adminCancelRoute(post({ confirm: true, reason: "abc def" }), params("d-1"))).status).toBe(409);
    expect(status("d-1")).toBe("IN_PROGRESS");
  });

  it("a paid draft cannot be cancelled here (needs the refund flow)", async () => {
    await abandoned();
    fake.db.orders.get("d-1").paymentVerifiedAt = PAID_AT;
    await expect(cancelDraftOrder("d-1", ADMIN.id, "abc def")).rejects.toMatchObject({ status: 409 });
    expect(status("d-1")).toBe("DRAFT");
  });

  it("a cancelled draft can no longer be republished", async () => {
    await abandoned();
    await cancelDraftOrder("d-1", ADMIN.id, "Customer unreachable");
    h.getSessionUser.mockResolvedValue(ADMIN);
    expect((await republishRoute(post({ confirm: true }), params("d-1"))).status).toBe(409);
    expect(status("d-1")).toBe("CANCELLED");
  });
});

// ------------------------------------- no path can publish an unpaid order

describe("no path can publish an unpaid order", () => {
  it("admin republish of an unpaid draft is refused", async () => {
    fake.seedOrder({ id: "d-1", status: "DRAFT" });
    await expect(republishDraftOrder("d-1", ADMIN.id)).rejects.toMatchObject({ status: 409 });
    expect(status("d-1")).toBe("DRAFT");
  });

  it("admin release of an unpaid in-progress order goes to DRAFT, not PENDING", async () => {
    fake.seedOrder({ id: "o-1", status: "IN_PROGRESS" });
    fake.seedAssignment({ id: "as-1", orderId: "o-1", boosterId: BOOSTER.id, status: "IN_PROGRESS", activeOrderId: "o-1" });
    await releaseAssignment("as-1", ADMIN.id, "ADMIN", "reassigning");
    expect(status("o-1")).toBe("DRAFT");
    expect(fake.db.assignments[0]).toMatchObject({ status: "RELEASED", endReason: "reassigning", activeOrderId: null });
    expect(await getAvailableOrders()).toEqual([]);
  });

  it("admin release of a paid order still returns it to the marketplace", async () => {
    fake.seedOrder({ id: "o-1", status: "IN_PROGRESS", paymentVerifiedAt: PAID_AT });
    fake.seedAssignment({ id: "as-1", orderId: "o-1", boosterId: BOOSTER.id, status: "IN_PROGRESS", activeOrderId: "o-1" });
    await releaseAssignment("as-1", ADMIN.id, "ADMIN");
    expect(status("o-1")).toBe("PENDING");
    expect((await getAvailableOrders()).map((o: any) => o.id)).toEqual(["o-1"]);
  });

  it("reassigning an unpaid order to another booster is refused", async () => {
    fake.seedOrder({ id: "o-1", status: "IN_PROGRESS" });
    fake.seedAssignment({ id: "as-1", orderId: "o-1", boosterId: BOOSTER.id, status: "IN_PROGRESS", activeOrderId: "o-1" });
    await expect(reassignOrder("o-1", BOOSTER_B.id, ADMIN.id)).rejects.toMatchObject({ code: "P2025" });
    expect(status("o-1")).toBe("IN_PROGRESS");
  });

  it("the legacy accept / start / decline paths no longer exist (they cannot revive an order)", () => {
    const root = join(__dirname, "..", "..");
    // "start" exists again (Phase 3) but only moves a CLAIMED order the
    // booster holds to IN_PROGRESS; it cannot publish or revive an order.
    for (const legacy of ["accept", "decline", "pause", "resume"]) {
      expect(existsSync(join(root, "app", "api", "booster", "orders", "[orderId]", legacy, "route.ts"))).toBe(false);
    }
  });

  it("only the verified Stripe webhook path writes paymentVerifiedAt", () => {
    const root = join(__dirname, "..", "..");
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === "generated" || name === "node_modules") continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) {
          const src = readFileSync(full, "utf8");
          // `data: { ... paymentVerifiedAt ... }` or `x.paymentVerifiedAt = ...`
          if (/data\s*:\s*\{[^}]*paymentVerifiedAt/.test(src) || /paymentVerifiedAt\s*=[^=]/.test(src)) {
            writers.push(relative(root, full).split("\\").join("/"));
          }
        }
      }
    };
    for (const dir of ["app", "lib", "components", "scripts"]) walk(join(root, dir));
    expect(writers).toEqual(["lib/payments/webhook.service.ts"]);
  });
});
