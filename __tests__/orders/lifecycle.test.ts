/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const state = {
    user: null as any,
    assignment: null as any,
    order: null as any,
  };
  const tx = {
    orderBoosterAssignment: {
      findUnique: vi.fn(async () => state.assignment && { ...state.assignment, order: state.order }),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      update: vi.fn(async ({ data }: any) => ({ ...state.assignment, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: "new-as", assignedAt: new Date(), ...data })),
    },
    order: {
      findUnique: vi.fn(async () => state.order),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: any) => ({ ...state.order, ...data })),
    },
    boosterProfile: { updateMany: vi.fn(async () => ({ count: 1 })) },
    boosterEarning: { findUnique: vi.fn(async () => null) },
    orderBid: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) }, orderEvent: { create: vi.fn(async ({ data }: any) => ({ id: "ev", ...data })) },
  };
  return { state, tx };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(async () => m.state.user) },
    $transaction: vi.fn(async (cb: any) => cb(m.tx)),
    ...m.tx,
  },
}));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn() }));

// Earnings allocation and the payments outbox are covered by the
// Postgres-backed tests in __tests__/payments; mocked here because this
// file's Prisma mock has no financial tables.
vi.mock("@/lib/finance/earnings", () => ({ allocateOnCompletion: vi.fn(async () => ({ outcome: "no_reservation" })) }));
vi.mock("@/lib/payments/outbox", () => ({ dispatchOutbox: vi.fn(async () => ({ done: 0, failed: 0 })), enqueueOutbox: vi.fn(async () => {}) }));
import {
  abandonOrder,
  claimOrder,
  completeAssignment,
  isOrderClaimable,
  releaseAssignment,
} from "@/lib/assignments/service";
import { createNotificationsForEvent } from "@/lib/notifications/service";
import { broadcastToOrder, revokeOrderAccess } from "@/lib/realtime/broadcast";

const TEST_GAME_PERMISSIONS = [{ gameSlug: "test-game", rankSystemId: "none", maxTargetRankValue: 0, regions: [], serviceSlugs: [] }];
const BOOSTER = "booster-1";
const ORDER = "order-1";
const AS = "as-1";
const approved = { id: BOOSTER, role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED", permissions: TEST_GAME_PERMISSIONS } };

function arrange(orderStatus = "IN_PROGRESS", assignmentStatus = "IN_PROGRESS", boosterId = BOOSTER) {
  m.state.user = approved;
  m.state.order = { id: ORDER, status: orderStatus, userId: "cust-1", gameSlug: "test-game", serviceSlug: "test-boost" };
  m.state.assignment = { id: AS, orderId: ORDER, boosterId, status: assignmentStatus, activeOrderId: ORDER };
}

const notifyTypes = () => vi.mocked(createNotificationsForEvent).mock.calls.map((c) => c[0].type);
const eventTypes = () => m.tx.orderEvent.create.mock.calls.map((c: any) => c[0].data.type);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("order completion", () => {
  it("assigned booster completes: COMPLETED + completedAt, history kept", async () => {
    arrange();
    await completeAssignment(AS, BOOSTER, "BOOSTER");
    const orderUpdate = m.tx.order.update.mock.calls[0][0] as any;
    // Conditional on IN_PROGRESS only: a paused order can never be completed.
    expect(orderUpdate.where).toEqual({ id: ORDER, status: "IN_PROGRESS" });
    expect(orderUpdate.data.status).toBe("COMPLETED");
    expect(orderUpdate.data.completedAt).toBeInstanceOf(Date);
    expect((m.tx.orderBoosterAssignment.update.mock.calls[0][0] as any).data).toMatchObject({ status: "COMPLETED", activeOrderId: null });
    expect(eventTypes()).toContain("ORDER_COMPLETED");
  });

  it("emits exactly one ORDER_COMPLETED notification event with an idempotency key", async () => {
    arrange();
    await completeAssignment(AS, BOOSTER, "BOOSTER");
    expect(notifyTypes()).toEqual(["ORDER_COMPLETED"]);
    expect(vi.mocked(createNotificationsForEvent).mock.calls[0][0]).toMatchObject({
      orderId: ORDER,
      assignmentId: AS,
      dedupeKey: `ORDER_COMPLETED:${ORDER}`,
    });
  });

  it("broadcasts COMPLETED (not PAUSED) so dashboards update", async () => {
    arrange();
    await completeAssignment(AS, BOOSTER, "BOOSTER");
    const events = vi.mocked(broadcastToOrder).mock.calls.map((c) => c[0]);
    expect(events.map((e) => e.event)).toEqual(["order.completed", "order.status_changed"]);
    expect((events[1].payload as any).newStatus).toBe("COMPLETED");
    expect(revokeOrderAccess).toHaveBeenCalledWith({ userId: BOOSTER, orderId: ORDER });
  });

  it("another booster cannot complete the order", async () => {
    arrange("IN_PROGRESS", "IN_PROGRESS", "booster-2");
    await expect(completeAssignment(AS, BOOSTER, "BOOSTER")).rejects.toThrow(/does not belong/);
    expect(m.tx.order.update).not.toHaveBeenCalled();
    expect(createNotificationsForEvent).not.toHaveBeenCalled();
  });

  it("an unapproved booster cannot complete", async () => {
    arrange();
    m.state.user = { ...approved, boosterProfile: { verificationStatus: "SUSPENDED" } };
    await expect(completeAssignment(AS, BOOSTER, "BOOSTER")).rejects.toThrow(/not approved/);
  });

  it("an already completed order cannot be completed again", async () => {
    arrange("COMPLETED", "COMPLETED");
    await expect(completeAssignment(AS, BOOSTER, "BOOSTER")).rejects.toThrow(/Cannot transition/);
    expect(createNotificationsForEvent).not.toHaveBeenCalled();
  });
});

describe("order abandonment", () => {
  it("moves the order to DRAFT and ends the assignment", async () => {
    arrange();
    await abandonOrder(AS, BOOSTER, "  Account has 2FA issues  ");
    const orderUpdate = m.tx.order.update.mock.calls[0][0] as any;
    expect(orderUpdate.data).toEqual({ status: "DRAFT" });
    const asUpdate = (m.tx.orderBoosterAssignment.update.mock.calls[0][0] as any).data;
    expect(asUpdate).toMatchObject({ status: "RELEASED", activeOrderId: null, endReason: "ABANDONED: Account has 2FA issues" });
    expect(eventTypes()).toEqual(["BOOSTER_ABANDONED", "ORDER_MOVED_TO_DRAFT"]);
    expect((m.tx.orderEvent.create.mock.calls[0][0] as any).data.metadata.reason).toBe("Account has 2FA issues");
  });

  it("notifies (admins via) BOOSTER_ABANDONED only, never ORDER_REOPENED", async () => {
    arrange();
    await abandonOrder(AS, BOOSTER, "reason");
    expect(notifyTypes()).toEqual(["BOOSTER_ABANDONED"]);
    expect(vi.mocked(createNotificationsForEvent).mock.calls[0][0].dedupeKey).toBe(`BOOSTER_ABANDONED:${AS}`);
    expect(revokeOrderAccess).toHaveBeenCalledWith({ userId: BOOSTER, orderId: ORDER });
  });

  it("is rejected while the customer has the order paused (nothing changes)", async () => {
    arrange("PAUSED", "PAUSED");
    await expect(abandonOrder(AS, BOOSTER, "reason")).rejects.toMatchObject({ name: "OrderStateConflictError" });
    expect(m.tx.order.update).not.toHaveBeenCalled();
    expect(m.tx.orderEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a booster who is not assigned", async () => {
    arrange("IN_PROGRESS", "IN_PROGRESS", "booster-2");
    await expect(abandonOrder(AS, BOOSTER, "reason")).rejects.toThrow(/does not belong/);
    expect(m.tx.order.update).not.toHaveBeenCalled();
  });

  it("a booster 'release' is treated as abandonment (order does not go back to PENDING)", async () => {
    arrange();
    await releaseAssignment(AS, BOOSTER, "BOOSTER", "can't continue");
    expect((m.tx.order.update.mock.calls[0][0] as any).data.status).toBe("DRAFT");
    expect(notifyTypes()).not.toContain("ORDER_REOPENED");
  });

  it("admin release of a paid order keeps the existing PENDING behaviour", async () => {
    arrange();
    m.state.order.paymentVerifiedAt = new Date("2026-11-01T00:00:00Z");
    m.state.user = { id: "admin-1", role: "ADMIN" };
    await releaseAssignment(AS, "admin-1", "ADMIN", "reassigning");
    const upd = m.tx.order.update.mock.calls[0][0] as any;
    expect(upd.data.status).toBe("PENDING");
    expect(upd.where).toMatchObject({ paymentVerifiedAt: { not: null } });
  });

  it("admin release of an unpaid order goes to DRAFT, never PENDING", async () => {
    arrange();
    m.state.user = { id: "admin-1", role: "ADMIN" };
    await releaseAssignment(AS, "admin-1", "ADMIN", "reassigning");
    const upd = m.tx.order.update.mock.calls[0][0] as any;
    expect(upd.data.status).toBe("DRAFT");
    expect(upd.where).toMatchObject({ paymentVerifiedAt: null });
    expect(eventTypes()).toContain("ORDER_MOVED_TO_DRAFT");
    expect(notifyTypes()).not.toContain("ORDER_REOPENED");
  });
});

describe("abandoned orders cannot be claimed before republishing", () => {
  it("isOrderClaimable is false for DRAFT", () => {
    const paid = new Date("2026-11-01T00:00:00Z");
    expect(isOrderClaimable({ status: "DRAFT", assignments: [], paymentVerifiedAt: paid })).toBe(false);
    expect(isOrderClaimable({ status: "PENDING", assignments: [], paymentVerifiedAt: paid })).toBe(true);
    // Phase 1: PENDING without a verified payment is never claimable.
    expect(isOrderClaimable({ status: "PENDING", assignments: [] })).toBe(false);
  });

  it("claimOrder rejects a DRAFT order", async () => {
    arrange("DRAFT");
    await expect(claimOrder(ORDER, BOOSTER)).rejects.toThrow(/expected PENDING/);
    expect(m.tx.orderBoosterAssignment.create).not.toHaveBeenCalled();
  });
});
