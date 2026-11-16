import { describe, expect, test, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  // Referenced by the prisma mock below but previously never declared (it
  // was `undefined` at runtime; TS2339).
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(async (callback: any) => {
    return callback({
      orderBoosterAssignment: {
        findUnique: m.findUnique,
        findFirst: m.findFirst,
        create: m.create,
        update: m.update,
      },
      order: { findUnique: m.findUnique, findMany: m.findMany, update: m.update },
      boosterEarning: { findUnique: vi.fn(async () => null) }, boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) }, orderEvent: { create: m.create },
      notification: { create: m.create },
      user: { findUnique: m.findUnique },
    });
  }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    orderBoosterAssignment: {
      findUnique: m.findUnique,
      findFirst: m.findFirst,
      create: m.create,
      update: m.update,
    },
    order: { findUnique: m.findUnique, findMany: m.findMany, update: m.update },
    boosterEarning: { findUnique: vi.fn(async () => null) }, boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) }, orderEvent: { create: m.create },
    notification: { create: m.create },
    user: { findUnique: m.findUnique },
    $transaction: m.transaction,
  },
}));

vi.mock("@/lib/notifications/service", () => ({
  createNotificationsForEvent: vi.fn(),
  createNotification: vi.fn(async () => {}),
}));

vi.mock("@/lib/realtime/broadcast", () => ({
  revokeOrderAccess: vi.fn(),
  broadcastToOrder: vi.fn(),
}));

// Earnings allocation and the payments outbox are covered by the
// Postgres-backed tests in __tests__/payments; mocked here because this
// file's Prisma mock has no financial tables.
vi.mock("@/lib/finance/earnings", () => ({ allocateOnCompletion: vi.fn(async () => ({ outcome: "no_reservation" })) }));
vi.mock("@/lib/payments/outbox", () => ({ dispatchOutbox: vi.fn(async () => ({ done: 0, failed: 0 })), enqueueOutbox: vi.fn(async () => {}) }));
import {
  releaseAssignment,
  cancelAssignment,
  completeAssignment,
  reassignOrder,
  abandonOrder,
} from "@/lib/assignments/service";
import { revokeOrderAccess } from "@/lib/realtime/broadcast";

describe("Booster Reassignment Revocation", () => {
  const ORDER_ID = "order-1";
  const BOOSTER_ID = "booster-1";
  const NEW_BOOSTER_ID = "booster-2";
  const ADMIN_ID = "admin-1";
  const ASSIGNMENT_ID = "assign-1";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("releaseAssignment", () => {
    test("revokes booster socket access when releasing assignment", async () => {
      m.findUnique
        .mockResolvedValueOnce({
          id: BOOSTER_ID,
          role: "BOOSTER",
          boosterProfile: { verificationStatus: "APPROVED" },
        })
        .mockResolvedValueOnce({
          id: ASSIGNMENT_ID,
          boosterId: BOOSTER_ID,
          orderId: ORDER_ID,
          status: "IN_PROGRESS",
          order: { id: ORDER_ID, status: "IN_PROGRESS" },
        });

      m.update
        .mockResolvedValueOnce({ id: ASSIGNMENT_ID, status: "RELEASED", activeOrderId: null })
        .mockResolvedValueOnce({ id: ORDER_ID, status: "PENDING" });

      await releaseAssignment(ASSIGNMENT_ID, BOOSTER_ID, "BOOSTER");

      expect(revokeOrderAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: BOOSTER_ID, orderId: ORDER_ID })
      );
    });
  });

  describe("cancelAssignment", () => {
    // Phase 1: only an admin may cancel; the booster still loses access.
    test("revokes booster socket access when an admin cancels the assignment", async () => {
      m.findUnique
        .mockResolvedValueOnce({
          id: ASSIGNMENT_ID,
          boosterId: BOOSTER_ID,
          orderId: ORDER_ID,
          status: "IN_PROGRESS",
          order: { id: ORDER_ID, status: "IN_PROGRESS" },
        });

      m.update
        .mockResolvedValueOnce({ id: ASSIGNMENT_ID, status: "CANCELLED", activeOrderId: null })
        .mockResolvedValueOnce({ id: ORDER_ID, status: "CANCELLED" });

      await cancelAssignment(ASSIGNMENT_ID, "admin-1", "ADMIN", "customer request");

      expect(revokeOrderAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: BOOSTER_ID, orderId: ORDER_ID })
      );
    });
  });

  describe("completeAssignment", () => {
    test("revokes booster socket access when completing assignment", async () => {
      m.findUnique
        .mockResolvedValueOnce({
          id: BOOSTER_ID,
          role: "BOOSTER",
          boosterProfile: { verificationStatus: "APPROVED" },
        })
        .mockResolvedValueOnce({
          id: ASSIGNMENT_ID,
          boosterId: BOOSTER_ID,
          orderId: ORDER_ID,
          status: "IN_PROGRESS",
          order: { id: ORDER_ID, status: "IN_PROGRESS" },
        });

      m.update.mockResolvedValueOnce({
        id: ASSIGNMENT_ID,
        status: "COMPLETED",
        activeOrderId: null,
      });

      await completeAssignment(ASSIGNMENT_ID, BOOSTER_ID, "BOOSTER");

      expect(revokeOrderAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: BOOSTER_ID, orderId: ORDER_ID })
      );
    });
  });

  describe("reassignOrder", () => {
    test("revokes old booster access and creates new assignment", async () => {
      m.findUnique
        .mockResolvedValueOnce({ role: "ADMIN" })
        .mockResolvedValueOnce({
          id: NEW_BOOSTER_ID,
          role: "BOOSTER",
          boosterProfile: { verificationStatus: "APPROVED" },
        })
        .mockResolvedValueOnce({ id: ORDER_ID, status: "IN_PROGRESS" });
      m.findFirst.mockResolvedValueOnce({
        id: ASSIGNMENT_ID,
        boosterId: BOOSTER_ID,
        orderId: ORDER_ID,
        status: "IN_PROGRESS",
      });

      m.update
        .mockResolvedValueOnce({ id: ASSIGNMENT_ID, status: "REASSIGNED" })
        .mockResolvedValueOnce({ id: ORDER_ID, status: "IN_PROGRESS" });

      m.create.mockResolvedValueOnce({
        id: "new-assign",
        orderId: ORDER_ID,
        boosterId: NEW_BOOSTER_ID,
        status: "IN_PROGRESS",
      });

      const result = await reassignOrder(ORDER_ID, ADMIN_ID, NEW_BOOSTER_ID);

      expect(revokeOrderAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: BOOSTER_ID, orderId: ORDER_ID })
      );
      expect(result.assignment.boosterId).toBe(NEW_BOOSTER_ID);
      expect(result.previousBoosterId).toBe(BOOSTER_ID);
    });

    test("rejects reassignment to ineligible booster", async () => {
      m.findUnique
        .mockResolvedValueOnce({ role: "ADMIN" })
        .mockResolvedValueOnce({
          id: NEW_BOOSTER_ID,
          role: "CUSTOMER",
          boosterProfile: null,
        });
      m.findFirst.mockResolvedValueOnce({
        id: ASSIGNMENT_ID,
        boosterId: BOOSTER_ID,
        orderId: ORDER_ID,
        status: "IN_PROGRESS",
      });

      await expect(
        reassignOrder(ORDER_ID, ADMIN_ID, NEW_BOOSTER_ID)
      ).rejects.toThrow(/not eligible/);
    });
  });

  describe("abandonOrder", () => {
    test("revokes booster access and marks order as PENDING", async () => {
      m.findUnique
        .mockResolvedValueOnce({
          id: BOOSTER_ID,
          role: "BOOSTER",
          boosterProfile: { verificationStatus: "APPROVED" },
        })
        .mockResolvedValueOnce({
          id: ASSIGNMENT_ID,
          boosterId: BOOSTER_ID,
          orderId: ORDER_ID,
          status: "IN_PROGRESS",
          order: { id: ORDER_ID, status: "IN_PROGRESS" },
        });

      m.update
        .mockResolvedValueOnce({ id: ASSIGNMENT_ID, status: "ABANDONED", activeOrderId: null })
        .mockResolvedValueOnce({ id: ORDER_ID, status: "PENDING" });

      await abandonOrder(ASSIGNMENT_ID, BOOSTER_ID);

      expect(revokeOrderAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: BOOSTER_ID, orderId: ORDER_ID })
      );
    });
  });
});