import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ order: null as { userId: string } | null, create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    order: { findUnique: vi.fn(async () => m.order) },
    supportTicket: { create: m.create },
    supportMessage: { create: vi.fn(async () => ({})) },
    user: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(), createNotification: vi.fn() }));

import { createSupportTicket } from "@/lib/support/service";
import { clearRateLimit } from "@/lib/security/sanitize";

const input = { subject: "Help", description: "Something broke", category: "ORDER_ISSUE" as const };

beforeEach(() => {
  clearRateLimit();
  m.create.mockReset();
  m.create.mockResolvedValue({ id: "t-1", customer: { id: "c1", name: null, email: null }, order: null });
});

describe("createSupportTicket order ownership", () => {
  it("refuses to attach another customer's order", async () => {
    m.order = { userId: "someone-else" };
    await expect(createSupportTicket("c1", { ...input, orderId: "o1" })).rejects.toThrow("Order not found");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown order", async () => {
    m.order = null;
    await expect(createSupportTicket("c1", { ...input, orderId: "nope" })).rejects.toThrow("Order not found");
  });

  it("attaches the customer's own order", async () => {
    m.order = { userId: "c1" };
    await createSupportTicket("c1", { ...input, orderId: "o1" });
    expect(m.create.mock.calls[0][0].data.orderId).toBe("o1");
  });

  it("keeps plain text as typed (no HTML mangling)", async () => {
    m.order = null;
    await createSupportTicket("c1", { ...input, description: "Rank < Gold & I can't log in <3" });
    expect(m.create.mock.calls[0][0].data.description).toBe("Rank < Gold & I can't log in <3");
  });
});
