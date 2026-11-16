import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

describe("realtime broadcast transport", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to NEXT_PUBLIC_SUPABASE_URL and sends to the PRIVATE topic", async () => {
    const { broadcastToOrder } = await import("@/lib/realtime/broadcast");
    const ok = await broadcastToOrder({
      orderId: "o1",
      event: "chat.message.created",
      payload: { messageId: "m1" },
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      { topic: "private-order:o1", event: "chat.message.created", payload: { messageId: "m1" }, private: true },
    ]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-role-key");
  });

  it("never throws when delivery fails (message is already committed)", async () => {
    const { broadcastToOrder } = await import("@/lib/realtime/broadcast");

    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await expect(
      broadcastToOrder({ orderId: "o1", event: "chat.message.created", payload: {} })
    ).resolves.toBe(false);

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(
      broadcastToOrder({ orderId: "o1", event: "chat.message.created", payload: {} })
    ).resolves.toBe(false);
  });

  it("skips (without throwing) when the service-role key is not configured", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { broadcastToOrder } = await import("@/lib/realtime/broadcast");
    await expect(
      broadcastToOrder({ orderId: "o1", event: "chat.message.created", payload: {} })
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
