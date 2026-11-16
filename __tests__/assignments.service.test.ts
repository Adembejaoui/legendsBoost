import { describe, expect, test, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  findUser: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(async (callback: any) => {
    return callback({
      orderBoosterAssignment: {
        findFirst: m.findFirst,
        findUnique: m.findUnique,
        create: m.create,
        update: m.update,
        updateMany: m.updateMany,
      },
      order: {
        findUnique: m.findUnique,
        findMany: m.findMany,
        update: m.update,
      },
      boosterEarning: { findUnique: vi.fn(async () => null) }, boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) }, orderEvent: { create: m.eventCreate },
    });
  }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: m.findUser, findMany: vi.fn(async () => []) },
    $transaction: m.transaction,
    order: { findUnique: m.findUnique, findMany: m.findMany, update: m.update },
    orderBoosterAssignment: {
      findFirst: m.findFirst,
      findUnique: m.findUnique,
      create: m.create,
      update: m.update,
    },
    boosterEarning: { findUnique: vi.fn(async () => null) }, boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) }, orderEvent: { create: m.eventCreate },
  },
}));
// Side effects after commit are not under test here (the prisma mock has no
// notification table, which made the winning claim reject).
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn() }));

// Earnings allocation and the payments outbox are covered by the
// Postgres-backed tests in __tests__/payments; mocked here because this
// file's Prisma mock has no financial tables.
vi.mock("@/lib/finance/earnings", () => ({ allocateOnCompletion: vi.fn(async () => ({ outcome: "no_reservation" })) }));
vi.mock("@/lib/payments/outbox", () => ({ dispatchOutbox: vi.fn(async () => ({ done: 0, failed: 0 })), enqueueOutbox: vi.fn(async () => {}) }));
import {
  claimOrder,
  setCustomerOrderPaused,
  abandonOrder,
  completeAssignment,
  cancelAssignment,
  releaseAssignment,
  getAvailableOrders,
  verifyBoosterEligibility,
} from "@/lib/assignments/service";
import {
  canOrderTransition,
  NotBoosterOwnerError,
  BoosterNotEligibleError,
  OrderAlreadyClaimedError,
  OrderNotFoundError,
  OrderNotClaimableError,
  NotOrderOwnerError,
  OrderStateConflictError,
} from "@/lib/assignments/types";
import { createNotificationsForEvent } from "@/lib/notifications/service";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import * as service from "@/lib/assignments/service";

const BOOSTER_ID = "booster-1";
const OTHER_BOOSTER_ID = "booster-2";
const ORDER_ID = "order-1";

function resetMocks() {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async (callback: any) => {
    return callback({
      orderBoosterAssignment: {
        findFirst: m.findFirst,
        findUnique: m.findUnique,
        create: m.create,
        update: m.update,
        updateMany: m.updateMany,
      },
      order: {
        findUnique: m.findUnique,
        findMany: m.findMany,
        update: m.update,
      },
      boosterEarning: { findUnique: vi.fn(async () => null) }, boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) }, orderEvent: { create: m.eventCreate },
    });
  });
}

const p2002 = () => {
  const e = new Error("Unique constraint") as Error & { code: string };
  e.code = "P2002";
  return e;
};

beforeEach(resetMocks);

describe("order status transitions", () => {
  test("supports the simplified lifecycle transitions", () => {
    // Phase 3: taking an order makes it CLAIMED; the booster then starts it.
    expect(canOrderTransition("PENDING", "CLAIMED")).toBe(true);
    expect(canOrderTransition("PENDING", "IN_PROGRESS")).toBe(false);
    expect(canOrderTransition("CLAIMED", "IN_PROGRESS")).toBe(true);
    expect(canOrderTransition("PENDING", "CANCELLED")).toBe(true);
    expect(canOrderTransition("IN_PROGRESS", "PAUSED")).toBe(true);
    expect(canOrderTransition("PAUSED", "IN_PROGRESS")).toBe(true);
    expect(canOrderTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canOrderTransition("PAUSED", "CANCELLED")).toBe(true);
    expect(canOrderTransition("IN_PROGRESS", "PENDING")).toBe(false);
    expect(canOrderTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canOrderTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
    expect(canOrderTransition("QUEUED", "ASSIGNED")).toBe(false);
    expect(canOrderTransition("ASSIGNED", "IN_PROGRESS")).toBe(false);
  });
});

describe("verifyBoosterEligibility", () => {
  test("approves an APPROVED booster", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    await expect(verifyBoosterEligibility(BOOSTER_ID)).resolves.toBeDefined();
  });

  test("rejects a customer", async () => {
    m.findUser.mockResolvedValueOnce({
      id: "c-1",
      role: "CUSTOMER",
      boosterProfile: undefined,
    });
    await expect(verifyBoosterEligibility("c-1")).rejects.toBeInstanceOf(
      BoosterNotEligibleError
    );
  });

  test("rejects a missing booster profile", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: null,
    });
    await expect(verifyBoosterEligibility(BOOSTER_ID)).rejects.toBeInstanceOf(
      BoosterNotEligibleError
    );
  });

  test.each(["PENDING", "REJECTED", "SUSPENDED"])(
    "rejects a booster with verification status %s",
    async (status) => {
      m.findUser.mockResolvedValueOnce({
        id: BOOSTER_ID,
        role: "BOOSTER",
        boosterProfile: { verificationStatus: status },
      });
      await expect(verifyBoosterEligibility(BOOSTER_ID)).rejects.toBeInstanceOf(
        BoosterNotEligibleError
      );
    }
  );
});

// claimOrder (Phase 3: lib/pool/service.ts claimNow / takeOrderTx) is covered
// by stateful tests instead of call-order mocks:
//   - atomic claim, one winner, OrderAlreadyClaimedError, conditional update
//     on PENDING + verified payment: __tests__/orders/marketplace-safety.test.ts
//   - DRAFT / unpaid orders not claimable: orders/lifecycle, marketplace-safety
//   - against Postgres (not found, not PENDING, paused, concurrency, events,
//     limits, ceilings, bids): __tests__/pool/pool.test.ts, payments/payment-flow

const CUSTOMER_ID = "customer-1";

function customerOrder(status: string, userId = CUSTOMER_ID) {
  return { id: ORDER_ID, userId, status };
}

describe("setCustomerOrderPaused (customer pause / resume)", () => {
  test("the owner pauses an in-progress order: order + assignment PAUSED, booster stays assigned", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("IN_PROGRESS"));
    m.findFirst.mockResolvedValueOnce({ id: "assign-1", boosterId: BOOSTER_ID });
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.update.mockResolvedValueOnce({ id: ORDER_ID, status: "PAUSED" });
    m.eventCreate.mockResolvedValueOnce({ id: "evt-1" });

    const result = await setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause");

    expect(result).toEqual({ changed: true, status: "PAUSED" });
    // Conditional writes: only the active IN_PROGRESS assignment / order.
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: "assign-1", status: "IN_PROGRESS", activeOrderId: ORDER_ID },
      data: { status: "PAUSED" },
    });
    expect(m.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID, userId: CUSTOMER_ID, status: "IN_PROGRESS" },
      data: { status: "PAUSED" },
    });
    // The assignment keeps activeOrderId (never released / cancelled).
    expect(JSON.stringify(m.updateMany.mock.calls)).not.toContain("activeOrderId\":null");
    // Who paused and when, in the operational order history.
    expect(m.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: ORDER_ID,
        type: "ORDER_PAUSED",
        metadata: { assignmentId: "assign-1", actorUserId: CUSTOMER_ID, actorRole: "CUSTOMER" },
      }),
    });
    // The booster is told immediately (notification + order channel).
    expect(createNotificationsForEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ORDER_PAUSED_BY_CUSTOMER",
        orderId: ORDER_ID,
        assignmentId: "assign-1",
        actorId: CUSTOMER_ID,
        dedupeKey: "ORDER_PAUSED:evt-1",
      })
    );
    expect(broadcastToOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        event: "order.status_changed",
        payload: expect.objectContaining({ previousStatus: "IN_PROGRESS", newStatus: "PAUSED", boosterId: BOOSTER_ID }),
      })
    );
  });

  test("the owner resumes a paused order and the booster is notified", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("PAUSED"));
    m.findFirst.mockResolvedValueOnce({ id: "assign-1", boosterId: BOOSTER_ID });
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.update.mockResolvedValueOnce({ id: ORDER_ID, status: "IN_PROGRESS" });
    m.eventCreate.mockResolvedValueOnce({ id: "evt-2" });

    const result = await setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "resume");

    expect(result).toEqual({ changed: true, status: "IN_PROGRESS" });
    expect(m.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: ORDER_ID, activeOrderId: ORDER_ID, status: "PAUSED" } })
    );
    expect(m.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "ORDER_RESUMED" }),
    });
    expect(createNotificationsForEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ORDER_RESUMED_BY_CUSTOMER", dedupeKey: "ORDER_RESUMED:evt-2" })
    );
  });

  test("another customer cannot pause the order (and learns nothing about it)", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("IN_PROGRESS", "someone-else"));
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).rejects.toBeInstanceOf(NotOrderOwnerError);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(createNotificationsForEvent).not.toHaveBeenCalled();
  });

  test("a missing order is reported like a foreign one", async () => {
    m.findUnique.mockResolvedValueOnce(null);
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).rejects.toBeInstanceOf(NotOrderOwnerError);
  });

  test.each(["COMPLETED", "CANCELLED", "PENDING", "DRAFT", "AWAITING_PAYMENT"])(
    "a %s order cannot be paused",
    async (status) => {
      m.findUnique.mockResolvedValueOnce(customerOrder(status));
      await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).rejects.toBeInstanceOf(OrderStateConflictError);
      expect(m.update).not.toHaveBeenCalled();
      expect(m.eventCreate).not.toHaveBeenCalled();
    }
  );

  test.each(["COMPLETED", "CANCELLED", "IN_PROGRESS"])("a %s order cannot be resumed", async (status) => {
    if (status === "IN_PROGRESS") {
      // Already running: a duplicate resume is a harmless no-op.
      m.findUnique.mockResolvedValueOnce(customerOrder(status));
      await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "resume")).resolves.toEqual({ changed: false, status: "IN_PROGRESS" });
      return;
    }
    m.findUnique.mockResolvedValueOnce(customerOrder(status));
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "resume")).rejects.toBeInstanceOf(OrderStateConflictError);
  });

  test("a duplicate pause is a no-op: no write, no event, no second notification", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("PAUSED"));
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).resolves.toEqual({ changed: false, status: "PAUSED" });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
    expect(createNotificationsForEvent).not.toHaveBeenCalled();
    expect(broadcastToOrder).not.toHaveBeenCalled();
  });

  test("an in-progress order with no working booster cannot be paused", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("IN_PROGRESS"));
    m.findFirst.mockResolvedValueOnce(null);
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).rejects.toBeInstanceOf(OrderStateConflictError);
  });

  test("a concurrent change to the assignment rolls back with a conflict", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("IN_PROGRESS"));
    m.findFirst.mockResolvedValueOnce({ id: "assign-1", boosterId: BOOSTER_ID });
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).rejects.toBeInstanceOf(OrderStateConflictError);
    expect(m.update).not.toHaveBeenCalled();
    expect(createNotificationsForEvent).not.toHaveBeenCalled();
  });

  test("a concurrent change to the order (P2025 on the conditional update) is a conflict", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("IN_PROGRESS"));
    m.findFirst.mockResolvedValueOnce({ id: "assign-1", boosterId: BOOSTER_ID });
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    m.update.mockRejectedValueOnce(p2025);
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).rejects.toBeInstanceOf(OrderStateConflictError);
    expect(createNotificationsForEvent).not.toHaveBeenCalled();
  });

  test("a failing notification never undoes the committed pause", async () => {
    m.findUnique.mockResolvedValueOnce(customerOrder("IN_PROGRESS"));
    m.findFirst.mockResolvedValueOnce({ id: "assign-1", boosterId: BOOSTER_ID });
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.update.mockResolvedValueOnce({});
    m.eventCreate.mockResolvedValueOnce({ id: "evt-3" });
    vi.mocked(createNotificationsForEvent).mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(setCustomerOrderPaused(ORDER_ID, CUSTOMER_ID, "pause")).resolves.toEqual({ changed: true, status: "PAUSED" });
    err.mockRestore();
  });

  test("boosters have no pause / resume function at all", () => {
    expect((service as Record<string, unknown>).pauseAssignment).toBeUndefined();
    expect((service as Record<string, unknown>).resumeAssignment).toBeUndefined();
    expect((service as Record<string, unknown>).acceptAssignment).toBeUndefined();
    // startAssignment exists (Phase 3) but only starts a CLAIMED order the
    // booster holds; it has nothing to do with pausing.
    expect((service as Record<string, unknown>).declineAssignment).toBeUndefined();
  });
});

describe("booster actions on a paused order", () => {
  const approved = () =>
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
  const pausedAssignment = () =>
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "PAUSED",
      activeOrderId: ORDER_ID,
      order: { id: ORDER_ID, status: "PAUSED", userId: CUSTOMER_ID },
    });

  test("another booster cannot complete (or abandon) someone else's order", async () => {
    m.findUser.mockResolvedValue({
      id: OTHER_BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    const foreign = {
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "IN_PROGRESS",
      activeOrderId: ORDER_ID,
      order: { id: ORDER_ID, status: "IN_PROGRESS", userId: CUSTOMER_ID },
    };
    m.findUnique.mockResolvedValueOnce(foreign);
    await expect(completeAssignment("assign-1", OTHER_BOOSTER_ID, "BOOSTER")).rejects.toBeInstanceOf(NotBoosterOwnerError);
    m.findUnique.mockResolvedValueOnce(foreign);
    await expect(abandonOrder("assign-1", OTHER_BOOSTER_ID, "not mine")).rejects.toBeInstanceOf(NotBoosterOwnerError);
    expect(m.update).not.toHaveBeenCalled();
  });

  test("the assigned booster cannot complete a paused order", async () => {
    approved();
    pausedAssignment();
    await expect(completeAssignment("assign-1", BOOSTER_ID, "BOOSTER")).rejects.toBeInstanceOf(OrderStateConflictError);
    expect(m.update).not.toHaveBeenCalled();
  });

  test("the assigned booster cannot abandon a paused order", async () => {
    approved();
    pausedAssignment();
    await expect(abandonOrder("assign-1", BOOSTER_ID, "Need to stop")).rejects.toBeInstanceOf(OrderStateConflictError);
    expect(m.update).not.toHaveBeenCalled();
  });

  test("releasing as a booster is an abandonment, so it is also blocked while paused", async () => {
    approved();
    pausedAssignment();
    await expect(releaseAssignment("assign-1", BOOSTER_ID, "BOOSTER", "bye")).rejects.toBeInstanceOf(OrderStateConflictError);
  });
});

describe("completeAssignment", () => {
  test("completes an IN_PROGRESS assignment and releases the active assignment state", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "IN_PROGRESS",
      order: { id: ORDER_ID, status: "IN_PROGRESS" },
    });
    m.update.mockResolvedValueOnce({
      id: "assign-1",
      status: "COMPLETED",
      activeOrderId: null,
    });

    const result = await completeAssignment("assign-1", BOOSTER_ID, "BOOSTER");

    const assignmentUpdate = m.update.mock.calls[0];
    expect(assignmentUpdate[0].where).toEqual({ id: "assign-1" });
    expect(assignmentUpdate[0].data).toMatchObject({
      status: "COMPLETED",
      activeOrderId: null,
      endedAt: expect.any(Date),
    });
    expect(result.assignment.status).toBe("COMPLETED");
  });
});

describe("cancelAssignment", () => {
  // Phase 1: only an admin may cancel the order (boosters abandon instead).
  test("admin cancels an IN_PROGRESS assignment and releases its active state", async () => {
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "IN_PROGRESS",
      order: { id: ORDER_ID, status: "IN_PROGRESS" },
    });
    m.update.mockResolvedValueOnce({ id: "assign-1", status: "CANCELLED", activeOrderId: null });

    await cancelAssignment("assign-1", "admin-1", "ADMIN", "customer request");

    const assignmentUpdate = m.update.mock.calls[0];
    expect(assignmentUpdate[0].data).toMatchObject({
      status: "CANCELLED",
      activeOrderId: null,
    });
    const orderUpdate = m.update.mock.calls[1];
    expect(orderUpdate[0].data.status).toBe("CANCELLED");
  });
});

describe("releaseAssignment", () => {
  // Business rule (order workspace): a booster dropping an order is an
  // abandonment -> DRAFT for admin review, never straight back to PENDING.
  test("a booster release moves the order to DRAFT (not back to the marketplace)", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "IN_PROGRESS",
      order: { id: ORDER_ID, status: "IN_PROGRESS" },
    });
    m.update.mockResolvedValueOnce({ id: "assign-1", status: "RELEASED", activeOrderId: null });

    await releaseAssignment("assign-1", BOOSTER_ID, "BOOSTER");

    const orderUpdate = m.update.mock.calls[1];
    expect(orderUpdate[0].data.status).toBe("DRAFT");
  });
});

describe("getAvailableOrders", () => {
  test("only returns paid PENDING orders without an active assignment", async () => {
    const paid = new Date("2026-11-01T00:00:00Z");
    m.findMany.mockResolvedValueOnce([
      { id: "o-1", status: "PENDING", paymentVerifiedAt: paid, assignments: [] },
      { id: "o-unpaid", status: "PENDING", paymentVerifiedAt: null, assignments: [] },
      { id: "o-2", status: "IN_PROGRESS", assignments: [] },
      {
        id: "o-3",
        status: "PENDING",
        paymentVerifiedAt: paid,
        assignments: [{ status: "PAUSED" }],
      },
      { id: "o-4", status: "CANCELLED", assignments: [] },
    ]);
    const orders = await getAvailableOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("o-1");
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({
      status: "PENDING",
      paymentVerifiedAt: { not: null },
    });
  });
});
