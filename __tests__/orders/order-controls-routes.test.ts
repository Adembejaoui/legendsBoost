/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HTTP layer of the order lifecycle controls:
 *  - POST /api/orders/:id/pause and /resume: customer owner only.
 *  - Booster routes: only claim / complete / abandon remain; release is
 *    admin-only; complete / abandon of a paused order is a 409.
 */
const m = vi.hoisted(() => ({
  user: null as any,
  order: null as any,
  setPaused: vi.fn(),
  complete: vi.fn(),
  abandon: vi.fn(),
  release: vi.fn(),
  mismatch: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/guards", () => ({
  getRealtimeEligibleUser: vi.fn(async () => m.user),
  getSessionUser: vi.fn(async () => m.user),
}));
vi.mock("@/lib/prisma", () => ({
  default: { order: { findUnique: vi.fn(async () => m.order) } },
}));
vi.mock("@/lib/assignments/service", () => ({
  setCustomerOrderPaused: m.setPaused,
  completeAssignment: m.complete,
  abandonOrder: m.abandon,
  releaseAssignment: m.release,
  ABANDON_REASON_MAX_LENGTH: 500,
}));
vi.mock("@/lib/assignments/route-guard", () => ({ rejectIfAssignmentNotInOrder: m.mismatch }));

import { POST as pauseRoute } from "@/app/api/orders/[orderId]/pause/route";
import { POST as resumeRoute } from "@/app/api/orders/[orderId]/resume/route";
import { POST as completeRoute } from "@/app/api/booster/orders/[orderId]/complete/route";
import { POST as abandonRoute } from "@/app/api/booster/orders/[orderId]/abandon/route";
import { POST as releaseRoute } from "@/app/api/booster/orders/[orderId]/release/route";
import { NotOrderOwnerError, OrderStateConflictError } from "@/lib/assignments/types";

const CUSTOMER = { id: "cust-1", role: "CUSTOMER" };
const OTHER_CUSTOMER = { id: "cust-2", role: "CUSTOMER" };
const BOOSTER = { id: "boost-1", role: "BOOSTER" };
const ADMIN = { id: "admin-1", role: "ADMIN" };

const params = { params: Promise.resolve({ orderId: "order-1" }) };
const req = (body: unknown = {}) =>
  new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function orderWith(status: string, assignmentStatus = status) {
  return {
    id: "order-1",
    userId: CUSTOMER.id,
    status,
    assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: assignmentStatus, activeOrderId: "order-1" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.user = CUSTOMER;
  m.order = orderWith("IN_PROGRESS");
  m.setPaused.mockResolvedValue({ changed: true, status: "PAUSED" });
});

describe("customer pause / resume routes", () => {
  it("the owner can pause; the server decides the order and user (body is ignored)", async () => {
    const res = await pauseRoute(req({ status: "COMPLETED", userId: "someone", orderId: "x" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "PAUSED", changed: true });
    expect(m.setPaused).toHaveBeenCalledWith("order-1", CUSTOMER.id, "pause");
  });

  it("the owner can resume", async () => {
    m.order = orderWith("PAUSED");
    m.setPaused.mockResolvedValue({ changed: true, status: "IN_PROGRESS" });
    const res = await resumeRoute(req(), params);
    expect(res.status).toBe(200);
    expect(m.setPaused).toHaveBeenCalledWith("order-1", CUSTOMER.id, "resume");
  });

  it("the assigned booster cannot pause or resume, even by calling the API directly", async () => {
    m.user = BOOSTER;
    expect((await pauseRoute(req(), params)).status).toBe(403);
    m.order = orderWith("PAUSED");
    expect((await resumeRoute(req(), params)).status).toBe(403);
    expect(m.setPaused).not.toHaveBeenCalled();
  });

  it("an admin cannot pause on the customer's behalf", async () => {
    m.user = ADMIN;
    expect((await pauseRoute(req(), params)).status).toBe(403);
    expect(m.setPaused).not.toHaveBeenCalled();
  });

  it("another customer gets 404 (no disclosure)", async () => {
    m.user = OTHER_CUSTOMER;
    expect((await pauseRoute(req(), params)).status).toBe(404);
    expect(m.setPaused).not.toHaveBeenCalled();
  });

  it("unauthenticated callers get 401", async () => {
    m.user = null;
    expect((await pauseRoute(req(), params)).status).toBe(401);
  });

  it("invalid state (completed / cancelled / race) is a 409 with the reason", async () => {
    m.setPaused.mockRejectedValue(new OrderStateConflictError("Only an order that is in progress can be paused."));
    const res = await pauseRoute(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/in progress/);
  });

  it("ownership re-checked in the service maps to 404", async () => {
    m.setPaused.mockRejectedValue(new NotOrderOwnerError());
    expect((await pauseRoute(req(), params)).status).toBe(404);
  });

  it("a duplicate request succeeds as a no-op", async () => {
    m.setPaused.mockResolvedValue({ changed: false, status: "PAUSED" });
    const res = await pauseRoute(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "PAUSED", changed: false });
  });
});

describe("booster order routes", () => {
  beforeEach(() => {
    m.user = BOOSTER;
  });

  it("complete of a paused order is rejected with 409", async () => {
    m.complete.mockRejectedValue(new OrderStateConflictError("This order is paused by the customer and cannot be completed until it is resumed."));
    const res = await completeRoute(req({ assignmentId: "as-1" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/paused/);
  });

  it("abandon of a paused order is rejected with 409", async () => {
    m.abandon.mockRejectedValue(new OrderStateConflictError("This order is paused by the customer and cannot be abandoned while paused."));
    const res = await abandonRoute(req({ assignmentId: "as-1", reason: "cannot continue" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/paused/);
  });

  it("a booster cannot use release (it is admin-only; boosters abandon)", async () => {
    const res = await releaseRoute(req({ assignmentId: "as-1" }), params);
    expect(res.status).toBe(403);
    expect(m.release).not.toHaveBeenCalled();
  });

  it("an admin can still release", async () => {
    m.user = ADMIN;
    m.release.mockResolvedValue({ assignment: { orderId: "order-1" } });
    const res = await releaseRoute(req({ assignmentId: "as-1" }), params);
    expect(res.status).toBe(200);
    expect(m.release).toHaveBeenCalledWith("as-1", ADMIN.id, "ADMIN", undefined);
  });

  it("a customer cannot complete or abandon", async () => {
    m.user = CUSTOMER;
    expect((await completeRoute(req({ assignmentId: "as-1" }), params)).status).toBe(403);
    expect((await abandonRoute(req({ assignmentId: "as-1", reason: "xyz" }), params)).status).toBe(403);
    expect(m.complete).not.toHaveBeenCalled();
    expect(m.abandon).not.toHaveBeenCalled();
  });
});
