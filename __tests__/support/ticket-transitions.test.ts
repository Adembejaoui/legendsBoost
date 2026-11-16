import { describe, expect, test, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  // Referenced by the prisma mock below but previously never declared (it
  // was `undefined` at runtime; TS2339).
  create: vi.fn(),
  transaction: vi.fn(async (callback: any) => {
    return callback({
      supportTicket: { findUnique: m.findUnique, update: m.update },
      notification: { create: m.create },
      user: { findUnique: m.findUnique },
    });
  }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    supportTicket: { findUnique: m.findUnique, update: m.update },
    notification: { create: m.create },
    user: { findUnique: m.findUnique },
    $transaction: m.transaction,
  },
}));

vi.mock("@/lib/notifications/service", () => ({
  createNotificationsForEvent: vi.fn(),
}));

import {
  updateSupportTicketStatus,
  assignSupportTicket,
  SUPPORT_TICKET_TRANSITIONS,
  validateSupportTicketTransition,
} from "@/lib/support/service";

describe("Support Ticket State Transitions", () => {
  const TICKET_ID = "ticket-1";
  const CUSTOMER_ID = "customer-1";
  const ADMIN_ID = "admin-1";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("validateSupportTicketTransition", () => {
    test("allows OPEN -> IN_PROGRESS", () => {
      expect(() => validateSupportTicketTransition("OPEN", "IN_PROGRESS")).not.toThrow();
    });

    test("allows OPEN -> CLOSED", () => {
      expect(() => validateSupportTicketTransition("OPEN", "CLOSED")).not.toThrow();
    });

    test("allows IN_PROGRESS -> WAITING_FOR_CUSTOMER", () => {
      expect(() => validateSupportTicketTransition("IN_PROGRESS", "WAITING_FOR_CUSTOMER")).not.toThrow();
    });

    test("allows IN_PROGRESS -> RESOLVED", () => {
      expect(() => validateSupportTicketTransition("IN_PROGRESS", "RESOLVED")).not.toThrow();
    });

    test("allows IN_PROGRESS -> CLOSED", () => {
      expect(() => validateSupportTicketTransition("IN_PROGRESS", "CLOSED")).not.toThrow();
    });

    test("allows WAITING_FOR_CUSTOMER -> IN_PROGRESS", () => {
      expect(() => validateSupportTicketTransition("WAITING_FOR_CUSTOMER", "IN_PROGRESS")).not.toThrow();
    });

    test("allows WAITING_FOR_CUSTOMER -> RESOLVED", () => {
      expect(() => validateSupportTicketTransition("WAITING_FOR_CUSTOMER", "RESOLVED")).not.toThrow();
    });

    test("allows WAITING_FOR_CUSTOMER -> CLOSED", () => {
      expect(() => validateSupportTicketTransition("WAITING_FOR_CUSTOMER", "CLOSED")).not.toThrow();
    });

    test("allows RESOLVED -> CLOSED", () => {
      expect(() => validateSupportTicketTransition("RESOLVED", "CLOSED")).not.toThrow();
    });

    test("allows RESOLVED -> IN_PROGRESS (reopen)", () => {
      expect(() => validateSupportTicketTransition("RESOLVED", "IN_PROGRESS")).not.toThrow();
    });

    test("allows CLOSED -> IN_PROGRESS (reopen)", () => {
      expect(() => validateSupportTicketTransition("CLOSED", "IN_PROGRESS")).not.toThrow();
    });

    test("rejects OPEN -> RESOLVED (skipping IN_PROGRESS)", () => {
      expect(() => validateSupportTicketTransition("OPEN", "RESOLVED")).toThrow(
        "Invalid ticket status transition: OPEN -> RESOLVED"
      );
    });

    test("rejects OPEN -> WAITING_FOR_CUSTOMER", () => {
      expect(() => validateSupportTicketTransition("OPEN", "WAITING_FOR_CUSTOMER")).toThrow(
        "Invalid ticket status transition: OPEN -> WAITING_FOR_CUSTOMER"
      );
    });

    test("rejects IN_PROGRESS -> OPEN", () => {
      expect(() => validateSupportTicketTransition("IN_PROGRESS", "OPEN")).toThrow(
        "Invalid ticket status transition: IN_PROGRESS -> OPEN"
      );
    });

    test("rejects CLOSED -> RESOLVED", () => {
      expect(() => validateSupportTicketTransition("CLOSED", "RESOLVED")).toThrow(
        "Invalid ticket status transition: CLOSED -> RESOLVED"
      );
    });

    test("rejects CLOSED -> WAITING_FOR_CUSTOMER", () => {
      expect(() => validateSupportTicketTransition("CLOSED", "WAITING_FOR_CUSTOMER")).toThrow(
        "Invalid ticket status transition: CLOSED -> WAITING_FOR_CUSTOMER"
      );
    });

    test("rejects RESOLVED -> WAITING_FOR_CUSTOMER", () => {
      expect(() => validateSupportTicketTransition("RESOLVED", "WAITING_FOR_CUSTOMER")).toThrow(
        "Invalid ticket status transition: RESOLVED -> WAITING_FOR_CUSTOMER"
      );
    });

    test("rejects invalid status", () => {
      expect(() => validateSupportTicketTransition("INVALID" as any, "OPEN")).toThrow(
        "Invalid ticket status transition"
      );
    });
  });

  describe("updateSupportTicketStatus", () => {
    test("validates transition before updating", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: TICKET_ID,
        customerId: CUSTOMER_ID,
        assignedAdminId: ADMIN_ID,
        subject: "Test Ticket",
        status: "OPEN",
      });
      m.update.mockResolvedValueOnce({});

      await expect(
        updateSupportTicketStatus(TICKET_ID, "RESOLVED", ADMIN_ID)
      ).rejects.toThrow("Invalid ticket status transition: OPEN -> RESOLVED");
    });

    test("allows valid transition OPEN -> IN_PROGRESS", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: TICKET_ID,
        customerId: CUSTOMER_ID,
        assignedAdminId: ADMIN_ID,
        subject: "Test Ticket",
        status: "OPEN",
      });
      m.update.mockResolvedValueOnce({});

      await expect(
        updateSupportTicketStatus(TICKET_ID, "IN_PROGRESS", ADMIN_ID)
      ).resolves.toEqual({ success: true });
    });

    test("allows valid transition IN_PROGRESS -> RESOLVED", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: TICKET_ID,
        customerId: CUSTOMER_ID,
        assignedAdminId: ADMIN_ID,
        subject: "Test Ticket",
        status: "IN_PROGRESS",
      });
      m.update.mockResolvedValueOnce({});

      await expect(
        updateSupportTicketStatus(TICKET_ID, "RESOLVED", ADMIN_ID)
      ).resolves.toEqual({ success: true });
    });

    test("allows reopening RESOLVED -> IN_PROGRESS", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: TICKET_ID,
        customerId: CUSTOMER_ID,
        assignedAdminId: ADMIN_ID,
        subject: "Test Ticket",
        status: "RESOLVED",
      });
      m.update.mockResolvedValueOnce({});

      await expect(
        updateSupportTicketStatus(TICKET_ID, "IN_PROGRESS", ADMIN_ID)
      ).resolves.toEqual({ success: true });
    });

    test("allows reopening CLOSED -> IN_PROGRESS", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: TICKET_ID,
        customerId: CUSTOMER_ID,
        assignedAdminId: ADMIN_ID,
        subject: "Test Ticket",
        status: "CLOSED",
      });
      m.update.mockResolvedValueOnce({});

      await expect(
        updateSupportTicketStatus(TICKET_ID, "IN_PROGRESS", ADMIN_ID)
      ).resolves.toEqual({ success: true });
    });

    test("throws error for non-existent ticket", async () => {
      m.findUnique.mockResolvedValueOnce(null);

      await expect(
        updateSupportTicketStatus(TICKET_ID, "IN_PROGRESS", ADMIN_ID)
      ).rejects.toThrow("Ticket not found");
    });
  });

  describe("assignSupportTicket", () => {
    test("allows admin assignment and transitions to IN_PROGRESS", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: ADMIN_ID,
        role: "ADMIN",
      });
      m.findUnique.mockResolvedValueOnce({
        id: TICKET_ID,
        subject: "Test Ticket",
        status: "OPEN",
        assignedAdminId: null,
        customerId: CUSTOMER_ID,
      });
      m.update.mockResolvedValueOnce({
        id: TICKET_ID,
        assignedAdminId: ADMIN_ID,
        status: "IN_PROGRESS",
      });

      const result = await assignSupportTicket(TICKET_ID, ADMIN_ID);

      expect(result.assignedAdminId).toBe(ADMIN_ID);
      expect(result.status).toBe("IN_PROGRESS");
    });

    test("rejects non-admin assignment", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: CUSTOMER_ID,
        role: "CUSTOMER",
      });

      await expect(assignSupportTicket(TICKET_ID, CUSTOMER_ID)).rejects.toThrow(
        "Only admins can be assigned to tickets"
      );
    });

    test("rejects assignment of non-existent ticket", async () => {
      m.findUnique.mockResolvedValueOnce({
        id: ADMIN_ID,
        role: "ADMIN",
      });
      m.findUnique.mockResolvedValueOnce(null);

      await expect(assignSupportTicket(TICKET_ID, ADMIN_ID)).rejects.toThrow(
        "Ticket not found"
      );
    });
  });

  describe("SUPPORT_TICKET_TRANSITIONS constant", () => {
    test("contains all expected statuses", () => {
      expect(SUPPORT_TICKET_TRANSITIONS).toHaveProperty("OPEN");
      expect(SUPPORT_TICKET_TRANSITIONS).toHaveProperty("IN_PROGRESS");
      expect(SUPPORT_TICKET_TRANSITIONS).toHaveProperty("WAITING_FOR_CUSTOMER");
      expect(SUPPORT_TICKET_TRANSITIONS).toHaveProperty("RESOLVED");
      expect(SUPPORT_TICKET_TRANSITIONS).toHaveProperty("CLOSED");
    });

    test("has correct transition count", () => {
      expect(SUPPORT_TICKET_TRANSITIONS.OPEN).toHaveLength(2);
      expect(SUPPORT_TICKET_TRANSITIONS.IN_PROGRESS).toHaveLength(3);
      expect(SUPPORT_TICKET_TRANSITIONS.WAITING_FOR_CUSTOMER).toHaveLength(3);
      expect(SUPPORT_TICKET_TRANSITIONS.RESOLVED).toHaveLength(2);
      expect(SUPPORT_TICKET_TRANSITIONS.CLOSED).toHaveLength(1);
    });
  });
});