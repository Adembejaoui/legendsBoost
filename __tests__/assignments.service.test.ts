import { describe, expect, test, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  findUser: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(async (callback: any) => {
    return callback({
      orderBoosterAssignment: {
        findFirst: m.findFirst,
        findUnique: m.findUnique,
        create: m.create,
        update: m.update,
      },
      order: {
        findUnique: m.findUnique,
        findMany: m.findMany,
        update: m.update,
      },
      orderEvent: { create: m.eventCreate },
    });
  }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: m.findUser },
    $transaction: m.transaction,
    order: { findUnique: m.findUnique, findMany: m.findMany, update: m.update },
    orderBoosterAssignment: {
      findFirst: m.findFirst,
      findUnique: m.findUnique,
      create: m.create,
      update: m.update,
    },
    orderEvent: { create: m.eventCreate },
  },
}));

import {
  claimOrder,
  pauseAssignment,
  resumeAssignment,
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
} from "@/lib/assignments/types";

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
      },
      order: {
        findUnique: m.findUnique,
        findMany: m.findMany,
        update: m.update,
      },
      orderEvent: { create: m.eventCreate },
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
    expect(canOrderTransition("PENDING", "IN_PROGRESS")).toBe(true);
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

describe("claimOrder", () => {
  const pendingOrder = { id: ORDER_ID, status: "PENDING" };
  const createdAssignment = { id: "assign-1", status: "IN_PROGRESS", activeOrderId: ORDER_ID };
  const updatedOrder = { id: ORDER_ID, status: "IN_PROGRESS" };

  test("claims a PENDING order atomically: assignment IN_PROGRESS, order IN_PROGRESS, event recorded", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findFirst.mockResolvedValueOnce(null);
    m.findUnique.mockResolvedValueOnce(pendingOrder);
    m.create.mockResolvedValueOnce(createdAssignment);
    m.update.mockResolvedValueOnce(updatedOrder);

    const result = await claimOrder(ORDER_ID, BOOSTER_ID);

    expect(m.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: ORDER_ID,
        status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"] },
      },
    });
    expect(m.create).toHaveBeenCalledWith({
      data: {
        orderId: ORDER_ID,
        boosterId: BOOSTER_ID,
        assignedById: BOOSTER_ID,
        status: "IN_PROGRESS",
        activeOrderId: ORDER_ID,
        startedAt: expect.any(Date),
      },
    });
    expect(m.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: "PENDING" },
      data: { status: "IN_PROGRESS" },
    });
    expect(m.eventCreate).toHaveBeenCalledWith({
      data: {
        orderId: ORDER_ID,
        type: "ORDER_CLAIMED",
        message: "Order claimed by booster",
        metadata: { assignmentId: "assign-1", boosterId: BOOSTER_ID },
      },
    });
    expect(result).toEqual({ assignment: createdAssignment, order: updatedOrder });
  });

  test("throws OrderNotFoundError when the order does not exist", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findFirst.mockResolvedValueOnce(null);
    m.findUnique.mockResolvedValueOnce(null);
    await expect(claimOrder(ORDER_ID, BOOSTER_ID)).rejects.toBeInstanceOf(
      OrderNotFoundError
    );
  });

  test("throws OrderNotClaimableError when the order is not PENDING", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findFirst.mockResolvedValueOnce(null);
    m.findUnique.mockResolvedValueOnce({ id: ORDER_ID, status: "COMPLETED" });
    await expect(claimOrder(ORDER_ID, BOOSTER_ID)).rejects.toBeInstanceOf(
      OrderNotClaimableError
    );
  });

  test("throws OrderAlreadyClaimedError when an active assignment already exists", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findFirst.mockResolvedValueOnce({ id: "assign-old", status: "IN_PROGRESS" });
    await expect(claimOrder(ORDER_ID, BOOSTER_ID)).rejects.toBeInstanceOf(
      OrderAlreadyClaimedError
    );
  });

  test("treats a PAUSED order as not claimable", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findFirst.mockResolvedValueOnce(null);
    m.findUnique.mockResolvedValueOnce({ id: ORDER_ID, status: "PAUSED" });
    await expect(claimOrder(ORDER_ID, BOOSTER_ID)).rejects.toBeInstanceOf(
      OrderNotClaimableError
    );
  });

  test("concurrent claims: exactly one succeeds, the other receives the already-claimed error", async () => {
    m.findUser.mockResolvedValue({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findFirst.mockResolvedValue(null);
    m.findUnique.mockResolvedValue(pendingOrder);
    let createCalls = 0;
    m.create.mockImplementation(() => {
      createCalls += 1;
      if (createCalls === 1) {
        return createdAssignment;
      }
      throw p2002();
    });

    const results = await Promise.allSettled([
      claimOrder(ORDER_ID, BOOSTER_ID),
      claimOrder(ORDER_ID, OTHER_BOOSTER_ID),
    ]);

    const settled = results.map((r) => r.status);
    expect(settled.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s === "rejected")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    expect(rejected?.reason).toBeInstanceOf(OrderAlreadyClaimedError);
    expect(rejected?.reason.message).toBe("This order has already been claimed.");
  });
});

describe("pauseAssignment", () => {
  test("assigned booster pauses IN_PROGRESS -> PAUSED and keeps the assignment active", async () => {
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
    const updated = { id: "assign-1", status: "PAUSED" };
    m.update.mockResolvedValueOnce(updated);

    const result = await pauseAssignment("assign-1", BOOSTER_ID, "BOOSTER");

    expect(m.update).toHaveBeenCalledWith({
      where: { id: "assign-1" },
      data: { status: "PAUSED" },
    });
    expect(m.eventCreate).toHaveBeenCalledWith({
      data: {
        orderId: ORDER_ID,
        type: "ORDER_PAUSED",
        message: "Order paused by booster",
        metadata: { assignmentId: "assign-1" },
      },
    });
    expect(result).toEqual(updated);
  });

  test("another booster cannot pause", async () => {
    m.findUser.mockResolvedValueOnce({
      id: OTHER_BOOSTER_ID,
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
    await expect(
      pauseAssignment("assign-1", OTHER_BOOSTER_ID, "BOOSTER")
    ).rejects.toBeInstanceOf(NotBoosterOwnerError);
  });

  test("an admin can pause another booster's assignment", async () => {
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: OTHER_BOOSTER_ID,
      orderId: ORDER_ID,
      status: "IN_PROGRESS",
      order: { id: ORDER_ID, status: "IN_PROGRESS" },
    });
    m.update.mockResolvedValueOnce({ id: "assign-1", status: "PAUSED" });
    await expect(
      pauseAssignment("assign-1", "admin-1", "ADMIN")
    ).resolves.toBeDefined();
  });

  test("cannot pause an already-paused assignment", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "PAUSED",
      order: { id: ORDER_ID, status: "PAUSED" },
    });
    await expect(
      pauseAssignment("assign-1", BOOSTER_ID, "BOOSTER")
    ).rejects.toThrow(/Cannot pause/);
  });
});

describe("resumeAssignment", () => {
  test("assigned booster resumes PAUSED -> IN_PROGRESS", async () => {
    m.findUser.mockResolvedValueOnce({
      id: BOOSTER_ID,
      role: "BOOSTER",
      boosterProfile: { verificationStatus: "APPROVED" },
    });
    m.findUnique.mockResolvedValueOnce({
      id: "assign-1",
      boosterId: BOOSTER_ID,
      orderId: ORDER_ID,
      status: "PAUSED",
      order: { id: ORDER_ID, status: "PAUSED" },
    });
    m.update.mockResolvedValueOnce({ id: "assign-1", status: "IN_PROGRESS" });
    const result = await resumeAssignment("assign-1", BOOSTER_ID, "BOOSTER");
    expect(result.status).toBe("IN_PROGRESS");
    expect(m.eventCreate).toHaveBeenCalledWith({
      data: {
        orderId: ORDER_ID,
        type: "ORDER_RESUMED",
        message: "Order resumed by booster",
        metadata: { assignmentId: "assign-1" },
      },
    });
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
    expect(result.status).toBe("COMPLETED");
  });
});

describe("cancelAssignment", () => {
  test("cancels an IN_PROGRESS assignment and releases its active state", async () => {
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
    m.update.mockResolvedValueOnce({ id: "assign-1", status: "CANCELLED", activeOrderId: null });

    await cancelAssignment("assign-1", BOOSTER_ID, "BOOSTER", "customer request");

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
  test("releases an assignment back to PENDING", async () => {
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
    expect(orderUpdate[0].data.status).toBe("PENDING");
  });
});

describe("getAvailableOrders", () => {
  test("only returns PENDING orders without an active assignment", async () => {
    m.findMany.mockResolvedValueOnce([
      { id: "o-1", status: "PENDING", assignments: [] },
      { id: "o-2", status: "IN_PROGRESS", assignments: [] },
      {
        id: "o-3",
        status: "PENDING",
        assignments: [{ status: "PAUSED" }],
      },
      { id: "o-4", status: "CANCELLED", assignments: [] },
    ]);
    const orders = await getAvailableOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("o-1");
  });
});
