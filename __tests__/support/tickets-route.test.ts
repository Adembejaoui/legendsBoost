/**
 * Regression: support ticket categories must match the database enum.
 *
 * The API previously accepted "ACCOUNT_ISSUE" (and passed any filter string
 * straight to Prisma). The Prisma/DB enum has no such value, so creating such
 * a ticket, or filtering the list by it (offered in the list UI), failed
 * inside Prisma with a 500. Invalid values are now rejected with 400 before
 * reaching the database; valid requests behave as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createSupportTicket: vi.fn(),
  getSupportTickets: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getSessionUser: m.getSessionUser }));
vi.mock("@/lib/security/sanitize", () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 1000 }),
  SUPPORT_TICKET_RATE_LIMIT: {},
}));
vi.mock("@/lib/support/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/support/service")>("@/lib/support/service");
  return { ...actual, createSupportTicket: m.createSupportTicket, getSupportTickets: m.getSupportTickets };
});

import { GET, POST } from "@/app/api/support/tickets/route";
import { SUPPORT_TICKET_CATEGORIES, isSupportTicketCategory } from "@/lib/support/service";
import { $Enums } from "@/app/generated/prisma/client";

const post = (body: unknown) =>
  new Request("http://localhost/api/support/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const get = (qs: string) => new Request(`http://localhost/api/support/tickets${qs}`) as unknown as NextRequest;

const valid = { subject: "Help", description: "Something broke", category: "ORDER_ISSUE" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getSessionUser.mockResolvedValue({ id: "cust-1", role: "CUSTOMER", email: null });
  m.createSupportTicket.mockResolvedValue({ id: "t-1" });
  m.getSupportTickets.mockResolvedValue({ tickets: [], total: 0 });
});

describe("support ticket categories follow the database enum", () => {
  it("the accepted categories are exactly the Prisma enum values", () => {
    expect([...SUPPORT_TICKET_CATEGORIES].sort()).toEqual(Object.values($Enums.SupportTicketCategory).sort());
    expect(isSupportTicketCategory("ACCOUNT_ISSUE")).toBe(false);
  });
});

describe("POST /api/support/tickets", () => {
  it("rejects ACCOUNT_ISSUE with 400 instead of failing in the database", async () => {
    const res = await POST(post({ ...valid, category: "ACCOUNT_ISSUE" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid category" });
    expect(m.createSupportTicket).not.toHaveBeenCalled();
  });

  it("rejects an unknown priority", async () => {
    const res = await POST(post({ ...valid, priority: "CRITICAL" }));
    expect(res.status).toBe(400);
    expect(m.createSupportTicket).not.toHaveBeenCalled();
  });

  it.each(Object.values($Enums.SupportTicketCategory))("accepts %s (unchanged contract)", async (category) => {
    const res = await POST(post({ ...valid, category, priority: "HIGH" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ticket: { id: "t-1" } });
    expect(m.createSupportTicket).toHaveBeenCalledWith("cust-1", {
      orderId: undefined,
      subject: "Help",
      description: "Something broke",
      category,
      priority: "HIGH",
    });
  });

  it("an omitted priority is passed as undefined (service default applies)", async () => {
    await POST(post(valid));
    expect(m.createSupportTicket.mock.calls[0][1].priority).toBeUndefined();
  });
});

describe("GET /api/support/tickets filters", () => {
  it.each([
    ["?category=ACCOUNT_ISSUE"],
    ["?status=ARCHIVED"],
    ["?priority=CRITICAL"],
  ])("rejects %s with 400 before querying", async (qs) => {
    const res = await GET(get(qs));
    expect(res.status).toBe(400);
    expect(m.getSupportTickets).not.toHaveBeenCalled();
  });

  it("passes valid filters through unchanged", async () => {
    const res = await GET(get("?category=PAYMENT_ISSUE&status=OPEN&priority=URGENT&page=2&limit=5"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tickets: [], total: 0, page: 2, limit: 5 });
    expect(m.getSupportTickets).toHaveBeenCalledWith("cust-1", "CUSTOMER", {
      page: 2,
      limit: 5,
      status: "OPEN",
      category: "PAYMENT_ISSUE",
      priority: "URGENT",
    });
  });

  it("no filters behaves as before", async () => {
    expect((await GET(get(""))).status).toBe(200);
    expect(m.getSupportTickets.mock.calls[0][2]).toEqual({
      page: 1, limit: 20, status: undefined, category: undefined, priority: undefined,
    });
  });
});

describe("POST /api/support/tickets: input and order ownership", () => {
  it("rejects over-long subjects and too-short descriptions", async () => {
    expect((await POST(post({ ...valid, subject: "x".repeat(201) }))).status).toBe(400);
    expect((await POST(post({ ...valid, description: "short" }))).status).toBe(400);
    expect(m.createSupportTicket).not.toHaveBeenCalled();
  });

  it("an order that is not the customer's answers 404", async () => {
    m.createSupportTicket.mockRejectedValue(new Error("Order not found"));
    const res = await POST(post({ ...valid, orderId: "someone-elses-order" }));
    expect(res.status).toBe(404);
  });
});
