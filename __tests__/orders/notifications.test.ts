/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  orderFind: vi.fn(),
  assignmentFind: vi.fn(),
  assignmentFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  conversationFind: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: { create: m.create },
    order: { findUnique: m.orderFind },
    orderBoosterAssignment: { findUnique: m.assignmentFind, findFirst: m.assignmentFindFirst },
    user: { findMany: m.userFindMany },
    orderConversation: { findUnique: m.conversationFind },
  },
}));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToUser: vi.fn() }));

import { createNotificationsForEvent } from "@/lib/notifications/service";
import { broadcastToUser } from "@/lib/realtime/broadcast";

const ORDER = "clorder000000000abcd1234";
const recipients = () => m.create.mock.calls.map((c) => c[0].data.userId).sort();

beforeEach(() => {
  vi.clearAllMocks();
  m.create.mockImplementation(async ({ data }: any) => ({ id: `n-${data.userId}`, createdAt: new Date(), ...data }));
  m.orderFind.mockResolvedValue({ userId: "cust-1" });
  m.assignmentFind.mockResolvedValue({ boosterId: "boost-1", orderId: ORDER });
  m.userFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
});

describe("completion notifications", () => {
  it("go to the customer, the completing booster and every admin", async () => {
    await createNotificationsForEvent({ type: "ORDER_COMPLETED", orderId: ORDER, assignmentId: "as-1", actorId: "boost-1", dedupeKey: `ORDER_COMPLETED:${ORDER}` });
    expect(recipients()).toEqual(["admin-1", "admin-2", "boost-1", "cust-1"]);
  });

  it("link to the order, are unread, carry the dedupe key and a real order number", async () => {
    await createNotificationsForEvent({ type: "ORDER_COMPLETED", orderId: ORDER, assignmentId: "as-1", actorId: "boost-1", dedupeKey: "K" });
    for (const [{ data }] of m.create.mock.calls) {
      expect(data.orderId).toBe(ORDER);
      expect(data.read).toBe(false);
      expect(data.dedupeKey).toBe("K");
      expect(data.message).toContain("#ABCD1234");
    }
  });

  it("an admin completing does not get a duplicate when also listed twice", async () => {
    m.assignmentFind.mockResolvedValue({ boosterId: "admin-1", orderId: ORDER });
    await createNotificationsForEvent({ type: "ORDER_COMPLETED", orderId: ORDER, assignmentId: "as-1", actorId: "admin-1" });
    expect(recipients()).toEqual(["admin-1", "admin-2", "cust-1"]);
  });

  it("ignores an assignment belonging to another order", async () => {
    m.assignmentFind.mockResolvedValue({ boosterId: "boost-9", orderId: "other-order" });
    await createNotificationsForEvent({ type: "ORDER_COMPLETED", orderId: ORDER, assignmentId: "as-x", actorId: "boost-9" });
    expect(recipients()).not.toContain("boost-9");
  });

  it("a retried completion does not duplicate (unique violation is swallowed, no broadcast)", async () => {
    m.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(
      createNotificationsForEvent({ type: "ORDER_COMPLETED", orderId: ORDER, assignmentId: "as-1", actorId: "boost-1", dedupeKey: "K" })
    ).resolves.toBeUndefined();
    expect(broadcastToUser).not.toHaveBeenCalled();
  });

  it("other database errors still surface", async () => {
    m.create.mockRejectedValue(new Error("db down"));
    await expect(
      createNotificationsForEvent({ type: "ORDER_COMPLETED", orderId: ORDER, assignmentId: "as-1", actorId: "boost-1", dedupeKey: "K" })
    ).rejects.toThrow("db down");
  });
});

describe("abandonment notifications", () => {
  it("go to administrators and the customer (never the abandoning booster)", async () => {
    await createNotificationsForEvent({ type: "BOOSTER_ABANDONED", orderId: ORDER, assignmentId: "as-1", actorId: "boost-1" });
    expect(recipients()).toEqual(["admin-1", "admin-2", "cust-1"]);
  });
});

describe("customer pause / resume notifications", () => {
  it("a pause reaches only the booster holding the order, with the stop instruction", async () => {
    m.assignmentFind.mockResolvedValue({ boosterId: "boost-1", orderId: ORDER, activeOrderId: ORDER });
    await createNotificationsForEvent({ type: "ORDER_PAUSED_BY_CUSTOMER", orderId: ORDER, assignmentId: "as-1", actorId: "cust-1", dedupeKey: "ORDER_PAUSED:e1" });
    expect(recipients()).toEqual(["boost-1"]);
    const { data } = m.create.mock.calls[0][0];
    // Stored under an existing NotificationType: no enum migration needed.
    expect(data.type).toBe("ORDER_PROGRESS_UPDATED");
    expect(data.message).toContain("Stop boosting immediately");
    expect(data.message).toContain("#ABCD1234");
    expect(data.dedupeKey).toBe("ORDER_PAUSED:e1");
    expect(broadcastToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "boost-1", event: "notification.created" }));
  });

  it("a resume tells the booster they may continue", async () => {
    m.assignmentFind.mockResolvedValue({ boosterId: "boost-1", orderId: ORDER, activeOrderId: ORDER });
    await createNotificationsForEvent({ type: "ORDER_RESUMED_BY_CUSTOMER", orderId: ORDER, assignmentId: "as-1", actorId: "cust-1" });
    expect(recipients()).toEqual(["boost-1"]);
    expect(m.create.mock.calls[0][0].data.message).toContain("You may continue boosting");
  });

  it("never reaches a booster whose assignment belongs to another order or was released", async () => {
    m.assignmentFind.mockResolvedValue({ boosterId: "boost-9", orderId: "other-order", activeOrderId: "other-order" });
    await createNotificationsForEvent({ type: "ORDER_PAUSED_BY_CUSTOMER", orderId: ORDER, assignmentId: "as-9", actorId: "cust-1" });
    m.assignmentFind.mockResolvedValue({ boosterId: "boost-1", orderId: ORDER, activeOrderId: null });
    await createNotificationsForEvent({ type: "ORDER_PAUSED_BY_CUSTOMER", orderId: ORDER, assignmentId: "as-1", actorId: "cust-1" });
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("republish notifications", () => {
  it("ORDER_REOPENED reaches the customer", async () => {
    await createNotificationsForEvent({ type: "ORDER_REOPENED", orderId: ORDER, actorId: "admin-1", dedupeKey: "R" });
    expect(recipients()).toEqual(["cust-1"]);
  });
});

describe("existing behaviour preserved", () => {
  it("chat notifications still skip the sender", async () => {
    m.conversationFind.mockResolvedValue({ id: "conv" });
    m.assignmentFindFirst.mockResolvedValue({ boosterId: "boost-1" });
    await createNotificationsForEvent({ type: "NEW_MESSAGE", orderId: ORDER, actorId: "boost-1" });
    expect(recipients()).toEqual(["cust-1"]);
    expect(m.create.mock.calls[0][0].data.dedupeKey).toBeNull();
  });
});
