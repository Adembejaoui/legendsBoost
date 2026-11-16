/* eslint-disable @typescript-eslint/no-explicit-any -- mocks */
/**
 * Live page updates (2026-11-16): the booster-only pool channel, server
 * signals (no data, never throw) and the browser LiveChannel (signals,
 * reconnect, refused token).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ sent: [] as { channel: string; event: string; payload: unknown }[], fail: false }));

vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn() }, supportTicket: { findUnique: vi.fn() } } }));
vi.mock("@/lib/chat/service", () => ({ canAccessConversation: vi.fn() }));
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastEvent: vi.fn(async (m: any) => {
    if (h.fail) throw new Error("network down");
    h.sent.push(m);
    return true;
  }),
  broadcastToOrder: vi.fn(async (m: any) => {
    if (h.fail) throw new Error("network down");
    h.sent.push({ channel: `private-order:${m.orderId}`, event: m.event, payload: m.payload });
    return true;
  }),
}));

import prisma from "@/lib/prisma";
import { canAccessChannel } from "@/lib/realtime/authorization";
import { parseChannel, poolChannel } from "@/lib/realtime/channel-names";
import { signalOrder, signalPool, signalUsers } from "@/lib/realtime/live";
import { LiveChannel, type LiveState } from "@/lib/realtime/live-client";
import { RealtimeHttpError } from "@/lib/chat/realtime-sync";

const db = prisma as any;

beforeEach(() => {
  h.sent.length = 0;
  h.fail = false;
  vi.clearAllMocks();
});

describe("pool channel access", () => {
  it("parses private-pool", () => {
    expect(poolChannel()).toBe("private-pool");
    expect(parseChannel("private-pool")).toEqual({ kind: "pool" });
  });

  it("only boosters with access may join", async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: "b1", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED" } });
    expect((await canAccessChannel({ id: "b1", role: "BOOSTER" } as any, "private-pool")).allowed).toBe(true);
    db.user.findUnique.mockResolvedValueOnce({ id: "b2", role: "BOOSTER", boosterProfile: { verificationStatus: "SUSPENDED" } });
    expect((await canAccessChannel({ id: "b2", role: "BOOSTER" } as any, "private-pool")).allowed).toBe(false);
    db.user.findUnique.mockResolvedValueOnce({ id: "c1", role: "CUSTOMER", boosterProfile: null });
    expect((await canAccessChannel({ id: "c1", role: "CUSTOMER" } as any, "private-pool")).allowed).toBe(false);
    db.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ADMIN", boosterProfile: null });
    expect((await canAccessChannel({ id: "a1", role: "ADMIN" } as any, "private-pool")).allowed).toBe(false);
  });
});

describe("server signals", () => {
  it("carry no order data and go to the right channels", async () => {
    await signalPool("added");
    await signalUsers(["u1", "u1", null, "u2"], "orders");
    await signalOrder("o1", "riot");
    expect(h.sent).toEqual([
      { channel: "private-pool", event: "pool.changed", payload: { reason: "added" } },
      { channel: "private-user:u1", event: "live.refresh", payload: { scope: "orders" } },
      { channel: "private-user:u2", event: "live.refresh", payload: { scope: "orders" } },
      { channel: "private-order:o1", event: "order.updated", payload: { orderId: "o1", reason: "riot" } },
    ]);
  });

  it("never throw when broadcasting fails", async () => {
    h.fail = true;
    await expect(signalPool("bid")).resolves.toBeUndefined();
    await expect(signalUsers(["u1"], "x")).resolves.toBeUndefined();
    await expect(signalOrder("o1", "x")).resolves.toBeUndefined();
  });
});

describe("LiveChannel (browser)", () => {
  type Handler = (msg: { payload?: unknown }) => void;
  function fakeClient() {
    const channels: { name: string; handlers: Map<string, Handler>; status?: (s: string, e?: Error) => void }[] = [];
    const client = {
      channel: vi.fn((name: string) => {
        const ch = { name, handlers: new Map<string, Handler>(), status: undefined as any };
        channels.push(ch);
        const api: any = {
          on: (_t: string, f: { event: string }, cb: Handler) => {
            ch.handlers.set(f.event, cb);
            return api;
          },
          subscribe: (cb: any) => {
            ch.status = cb;
            return api;
          },
        };
        return api;
      }),
      removeChannel: vi.fn(async () => {}),
      removeAllChannels: vi.fn(async () => {}),
      disconnect: vi.fn(),
    };
    return { client, channels };
  }

  afterEach(() => vi.useRealTimers());

  it("signals on listed events and refetches after a reconnect", async () => {
    vi.useFakeTimers();
    const { client, channels } = fakeClient();
    const signals: string[] = [];
    const states: LiveState[] = [];
    const live = new LiveChannel({
      channel: "private-pool",
      events: ["pool.changed"],
      createClient: () => client as any,
      fetchToken: async () => ({ token: "t", expiresInMs: 60_000 }),
      onSignal: (e) => signals.push(e),
      onState: (s) => states.push(s),
    });
    await live.start();
    channels[0].status!("SUBSCRIBED");
    channels[0].handlers.get("pool.changed")!({ payload: { reason: "added" } });
    expect(signals).toEqual(["pool.changed"]);

    channels[0].status!("CHANNEL_ERROR", new Error("socket closed"));
    expect(states).toEqual(["connecting", "live", "down"]);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(channels).toHaveLength(2);
    channels[1].status!("SUBSCRIBED");
    expect(signals).toEqual(["pool.changed", "reconnected"]);
    expect(states.at(-1)).toBe("live");
    await live.stop();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it("stops when the server refuses the token", async () => {
    const { client } = fakeClient();
    const states: LiveState[] = [];
    const live = new LiveChannel({
      channel: "private-pool",
      events: ["pool.changed"],
      createClient: () => client as any,
      fetchToken: async () => {
        throw new RealtimeHttpError(403, "no");
      },
      onSignal: () => {},
      onState: (s) => states.push(s),
    });
    await live.start();
    expect(states).toEqual(["connecting", "unauthorized"]);
    expect(client.channel).not.toHaveBeenCalled();
  });
});
