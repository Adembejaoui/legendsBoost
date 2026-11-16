import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canAccessConversation: vi.fn(),
  getOrCreateConversation: vi.fn(async () => ({ id: "conv-1" })),
  getMessages: vi.fn(async () => ({ messages: [], total: 0 })),
  getMessagesSince: vi.fn(async (): Promise<unknown[]> => []),
  sendMessage: vi.fn(),
  markMessagesAsRead: vi.fn(async () => {}),
  checkRateLimit: vi.fn(() => ({ allowed: true, resetAt: Date.now() + 60_000 })),
}));

vi.mock("@/lib/auth/guards", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/chat/service", () => ({
  canAccessConversation: mocks.canAccessConversation,
  getOrCreateConversation: mocks.getOrCreateConversation,
  getMessages: mocks.getMessages,
  getMessagesSince: mocks.getMessagesSince,
  sendMessage: mocks.sendMessage,
  markMessagesAsRead: mocks.markMessagesAsRead,
}));
vi.mock("@/lib/security/sanitize", () => ({
  checkRateLimit: mocks.checkRateLimit,
  MESSAGE_RATE_LIMIT: { windowMs: 60_000, maxRequests: 30 },
}));

import type { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/orders/[orderId]/messages/route";

const params = (orderId = "order-1") => ({ params: Promise.resolve({ orderId }) });
const get = (qs = "") =>
  new Request(`http://localhost/api/orders/order-1/messages${qs}`) as unknown as NextRequest;
const post = (body: unknown) =>
  new Request("http://localhost/api/orders/order-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe("order messages API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "u1", role: "CUSTOMER" });
    mocks.canAccessConversation.mockResolvedValue(true);
  });

  it("rejects unauthenticated reads and writes", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(get(), params())).status).toBe(401);
    expect((await POST(post({ content: "x" }), params())).status).toBe(401);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects users who do not belong to the order (403) for reads, catch-up and writes", async () => {
    mocks.canAccessConversation.mockResolvedValue(false);
    expect((await GET(get(), params())).status).toBe(403);
    expect((await GET(get("?after=2026-11-12T10:00:00.000Z"), params())).status).toBe(403);
    expect((await POST(post({ content: "x" }), params())).status).toBe(403);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.getMessagesSince).not.toHaveBeenCalled();
    // Authorization uses the server session identity, not request input.
    expect(mocks.canAccessConversation).toHaveBeenCalledWith("u1", "CUSTOMER", "order-1");
  });

  it("serves catch-up queries with an inclusive cursor and hasMore", async () => {
    mocks.getMessagesSince.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ id: `m${i}` })));
    const res = await GET(get("?after=2026-11-12T10:00:00.000Z&limit=100"), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasMore).toBe(true);
    expect(mocks.getMessagesSince).toHaveBeenCalledWith("conv-1", new Date("2026-11-12T10:00:00.000Z"), 100);
    expect(mocks.markMessagesAsRead).toHaveBeenCalled();
  });

  it("does not mark messages read when markRead=false (hidden tab)", async () => {
    await GET(get("?after=2026-11-12T10:00:00.000Z&markRead=false"), params());
    expect(mocks.markMessagesAsRead).not.toHaveBeenCalled();
  });

  it("rejects invalid cursors", async () => {
    expect((await GET(get("?after=not-a-date"), params())).status).toBe(400);
    expect((await GET(get("?before=nope"), params())).status).toBe(400);
  });

  it("passes a valid clientMessageId through and drops malformed ones", async () => {
    mocks.sendMessage.mockResolvedValue({ id: "m1" });

    const ok = await POST(post({ content: "hi", clientMessageId: "abcdef1234567890" }), params());
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ message: { id: "m1" }, clientMessageId: "abcdef1234567890" });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith("conv-1", "u1", "hi", "order-1", "abcdef1234567890", { senderRole: "CUSTOMER" });

    await POST(post({ content: "hi", clientMessageId: "<script>" }), params());
    expect(mocks.sendMessage).toHaveBeenLastCalledWith("conv-1", "u1", "hi", "order-1", null, { senderRole: "CUSTOMER" });
  });

  it("rejects empty messages", async () => {
    expect((await POST(post({ content: "   " }), params())).status).toBe(400);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
