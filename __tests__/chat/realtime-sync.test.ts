/**
 * Integration-style tests for the order chat realtime sync, using an
 * in-memory Realtime broker that enforces the same rule as the production
 * RLS policy (a client may only read the topic its token was issued for) and
 * an in-memory "server" that persists then broadcasts, like lib/chat/service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  OrderChatSync,
  RealtimeHttpError,
  type ChannelLike,
  type ChatConnectionState,
  type RealtimeLike,
} from "@/lib/chat/realtime-sync";
import {
  latestConfirmedTimestamp,
  mergeMessages,
  type ChatMessage,
} from "@/lib/chat/message-sync";

// ------------------------------------------------------------------ fakes

class FakeChannel implements ChannelLike {
  handlers = new Map<string, (msg: { payload?: unknown }) => void>();
  statusCb: ((status: string, err?: Error) => void) | null = null;
  joined = false;
  constructor(
    public topic: string,
    public isPrivate: boolean,
    private client: FakeClient
  ) {}
  on(_t: "broadcast", filter: { event: string }, cb: (msg: { payload?: unknown }) => void) {
    this.handlers.set(filter.event, cb);
    return this;
  }
  subscribe(cb: (status: string, err?: Error) => void) {
    this.statusCb = cb;
    void this.client.broker.join(this, this.client);
    return this;
  }
  status(s: string, err?: Error) {
    this.statusCb?.(s, err);
  }
}

class FakeClient implements RealtimeLike {
  channels: FakeChannel[] = [];
  disconnected = false;
  constructor(public broker: Broker, public accessToken: () => Promise<string>) {}
  channel(name: string, opts: { config: { private: boolean } }) {
    const ch = new FakeChannel(name, opts.config.private, this);
    this.channels.push(ch);
    return ch;
  }
  async removeChannel(ch: FakeChannel) {
    this.broker.leave(ch);
    this.channels = this.channels.filter((c) => c !== ch);
    ch.status("CLOSED");
  }
  async removeAllChannels() {
    for (const ch of [...this.channels]) await this.removeChannel(ch);
  }
  async disconnect() {
    this.disconnected = true;
  }
}

/** Mimics Supabase Realtime + the realtime.messages RLS policy. */
class Broker {
  online = true;
  subscribers = new Set<FakeChannel>();
  async join(ch: FakeChannel, client: FakeClient) {
    await Promise.resolve();
    if (!this.online) return ch.status("TIMED_OUT");
    if (!ch.isPrivate) return ch.status("CHANNEL_ERROR", new Error("public channels disabled"));
    const token = await client.accessToken();
    if (token !== `token-for:${ch.topic}`) {
      return ch.status(
        "CHANNEL_ERROR",
        new Error(`Unauthorized: You do not have permissions to read from this Channel topic: ${ch.topic}`)
      );
    }
    ch.joined = true;
    this.subscribers.add(ch);
    ch.status("SUBSCRIBED");
  }
  leave(ch: FakeChannel) {
    ch.joined = false;
    this.subscribers.delete(ch);
  }
  broadcast(topic: string, event: string, payload: unknown) {
    if (!this.online) return;
    for (const ch of this.subscribers) {
      if (ch.topic === topic) ch.handlers.get(event)?.({ payload });
    }
  }
  /** Network drop: every joined channel errors out. */
  dropAll() {
    this.online = false;
    for (const ch of [...this.subscribers]) {
      this.leave(ch);
      ch.status("CHANNEL_ERROR", new Error("socket closed"));
    }
  }
}

const ORDER = "order-1";
const TOPIC = `private-order:${ORDER}`;

/** Persist-then-broadcast server, like lib/chat/service.sendMessage. */
class FakeServer {
  db: ChatMessage[] = [];
  members = new Set(["customer", "booster"]);
  private clock = Date.parse("2026-11-12T10:00:00.000Z");
  constructor(private broker: Broker) {}
  send(senderId: string, content: string, clientMessageId: string | null = null) {
    if (!this.members.has(senderId)) throw new RealtimeHttpError(403, "Forbidden");
    this.clock += 1000;
    const m: ChatMessage = {
      id: `m${this.db.length + 1}`,
      conversationId: "conv-1",
      senderId,
      content,
      messageType: "text",
      readAt: null,
      createdAt: new Date(this.clock).toISOString(),
      sender: { id: senderId, name: senderId, image: null },
      status: "sent",
    };
    this.db.push(m);
    this.broker.broadcast(TOPIC, "chat.message.created", {
      messageId: m.id,
      conversationId: m.conversationId,
      orderId: ORDER,
      senderId,
      senderName: senderId,
      senderImage: null,
      content,
      messageType: "text",
      createdAt: m.createdAt,
      clientMessageId,
    });
    return { ...m, clientMessageId };
  }
  token(userId: string, channel: string) {
    if (!this.members.has(userId)) throw new RealtimeHttpError(403, "Forbidden");
    return { token: `token-for:${channel}`, expiresInMs: 15 * 60 * 1000 };
  }
  since(userId: string, after: string | null) {
    if (!this.members.has(userId)) throw new RealtimeHttpError(403, "Forbidden");
    const t = after ? Date.parse(after) : -Infinity;
    return this.db.filter((m) => Date.parse(m.createdAt) >= t).map((m) => ({ ...m }));
  }
}

/** One browser tab: its own message list + OrderChatSync. */
function makeParticipant(userId: string, broker: Broker, server: FakeServer, initial: ChatMessage[] = []) {
  const view = {
    messages: mergeMessages([], initial),
    states: [] as ChatConnectionState[],
    clients: [] as FakeClient[],
    tokenRequests: 0,
    sync: null as unknown as OrderChatSync,
  };
  view.sync = new OrderChatSync({
    orderId: ORDER,
    createClient: (accessToken) => {
      const c = new FakeClient(broker, accessToken);
      view.clients.push(c);
      return c;
    },
    fetchToken: async (channel) => {
      view.tokenRequests++;
      return server.token(userId, channel);
    },
    fetchSince: async (after) => ({ messages: server.since(userId, after), hasMore: false }),
    getCursor: () => latestConfirmedTimestamp(view.messages),
    onMessages: (incoming) => {
      view.messages = mergeMessages(view.messages, incoming);
    },
    onState: (s) => view.states.push(s),
  });
  return view;
}

const ids = (list: ChatMessage[]) => list.map((m) => m.id);
const flush = () => vi.advanceTimersByTimeAsync(0);

// ------------------------------------------------------------------ tests

describe("order chat realtime sync", () => {
  let broker: Broker;
  let server: FakeServer;

  beforeEach(() => {
    vi.useFakeTimers();
    broker = new Broker();
    server = new FakeServer(broker);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("customer → booster: booster receives the message without refreshing", async () => {
    const customer = makeParticipant("customer", broker, server);
    const booster = makeParticipant("booster", broker, server);
    await customer.sync.start();
    await booster.sync.start();
    await flush();
    expect(booster.sync.getState()).toBe("live");

    server.send("customer", "hello booster");
    expect(booster.messages.map((m) => m.content)).toEqual(["hello booster"]);
    expect(customer.messages.map((m) => m.content)).toEqual(["hello booster"]);
  });

  it("booster → customer: customer receives the message without refreshing", async () => {
    const customer = makeParticipant("customer", broker, server);
    const booster = makeParticipant("booster", broker, server);
    await customer.sync.start();
    await booster.sync.start();
    await flush();

    server.send("booster", "on it!");
    expect(customer.messages.map((m) => m.content)).toEqual(["on it!"]);
  });

  it("sender sees the message immediately and exactly once (optimistic + echo + POST response)", async () => {
    const customer = makeParticipant("customer", broker, server);
    await customer.sync.start();
    await flush();

    // Optimistic insert, as OrderChat does before the POST resolves.
    const optimistic: ChatMessage = {
      id: "local-c1",
      conversationId: "conv-1",
      senderId: "customer",
      content: "fast",
      messageType: "text",
      readAt: null,
      createdAt: new Date().toISOString(),
      status: "sending",
      clientMessageId: "c1",
    };
    customer.messages = mergeMessages(customer.messages, [optimistic]);
    expect(customer.messages.map((m) => m.content)).toEqual(["fast"]);

    // Server persists + broadcasts (echo reaches the sender first) ...
    const response = server.send("customer", "fast", "c1");
    // ... then the POST response arrives.
    customer.messages = mergeMessages(customer.messages, [response]);
    // ... and a later catch-up overlaps too.
    await customer.sync.catchUp();

    expect(ids(customer.messages)).toEqual(["m1"]);
    expect(customer.messages[0].status).toBe("sent");
  });

  it("keeps many messages in order with no duplicates across echo + catch-up overlap", async () => {
    const customer = makeParticipant("customer", broker, server);
    const booster = makeParticipant("booster", broker, server);
    await customer.sync.start();
    await booster.sync.start();
    await flush();

    for (let i = 0; i < 10; i++) server.send(i % 2 ? "booster" : "customer", `msg ${i}`);
    await booster.sync.catchUp();
    await customer.sync.catchUp();

    const expected = server.db.map((m) => m.id);
    expect(ids(booster.messages)).toEqual(expected);
    expect(ids(customer.messages)).toEqual(expected);
  });

  it("closes the race between initial history and subscription", async () => {
    // Page rendered with m1; m2 is sent before the subscription becomes live.
    server.send("customer", "first");
    const booster = makeParticipant("booster", broker, server, server.since("booster", null));
    server.send("customer", "sent during page load");

    await booster.sync.start();
    await flush(); // SUBSCRIBED → catch-up
    expect(booster.messages.map((m) => m.content)).toEqual(["first", "sent during page load"]);
  });

  it("recovers after a disconnect and fetches messages sent while offline", async () => {
    const customer = makeParticipant("customer", broker, server);
    const booster = makeParticipant("booster", broker, server);
    await customer.sync.start();
    await booster.sync.start();
    await flush();
    server.send("customer", "before drop");

    broker.dropAll();
    await flush();
    expect(booster.sync.getState()).toBe("reconnecting");

    // Sent while the booster is disconnected: persisted but not delivered.
    server.send("customer", "while offline 1");
    server.send("customer", "while offline 2");
    expect(booster.messages.map((m) => m.content)).toEqual(["before drop"]);

    broker.online = true;
    await vi.advanceTimersByTimeAsync(1_000); // first backoff step
    expect(booster.sync.getState()).toBe("live");
    expect(booster.messages.map((m) => m.content)).toEqual([
      "before drop",
      "while offline 1",
      "while offline 2",
    ]);

    // And live delivery works again.
    server.send("customer", "after reconnect");
    expect(booster.messages.at(-1)?.content).toBe("after reconnect");
    expect(new Set(ids(booster.messages)).size).toBe(booster.messages.length);
  });

  it("nudge() (browser back online) resubscribes immediately without waiting for backoff", async () => {
    const booster = makeParticipant("booster", broker, server);
    await booster.sync.start();
    await flush();
    broker.dropAll();
    await flush();
    server.send("customer", "missed");

    broker.online = true;
    booster.sync.nudge();
    await flush();
    expect(booster.sync.getState()).toBe("live");
    expect(booster.messages.map((m) => m.content)).toEqual(["missed"]);
  });

  it("denies a user who is not on the order: no token, no channel, no messages", async () => {
    const outsider = makeParticipant("outsider", broker, server);
    await outsider.sync.start();
    await flush();

    expect(outsider.sync.getState()).toBe("unauthorized");
    expect(outsider.clients).toHaveLength(0);
    server.send("customer", "private");
    expect(outsider.messages).toHaveLength(0);
  });

  it("the broker (RLS stand-in) rejects a token minted for a different order", async () => {
    const client = new FakeClient(broker, async () => "token-for:private-order:other-order");
    const ch = client.channel(TOPIC, { config: { private: true } });
    const statuses: string[] = [];
    ch.subscribe((s) => statuses.push(s));
    await flush();
    expect(statuses[0]).toBe("CHANNEL_ERROR");
    expect(broker.subscribers.size).toBe(0);
  });

  it("stops delivering when access is revoked at token refresh (e.g. booster reassigned)", async () => {
    const booster = makeParticipant("booster", broker, server);
    await booster.sync.start();
    await flush();
    expect(booster.sync.getState()).toBe("live");

    server.members.delete("booster");
    // realtime-js calls accessToken() on every heartbeat; after the refresh
    // window the token is re-requested and the server now refuses it.
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await booster.clients[0].accessToken().catch(() => {});
    await flush();

    expect(booster.sync.getState()).toBe("unauthorized");
    expect(booster.clients[0].disconnected).toBe(true);
    server.send("customer", "after revocation");
    expect(booster.messages).toHaveLength(0);
  });

  it("caches the token between heartbeats instead of hitting the auth endpoint", async () => {
    const booster = makeParticipant("booster", broker, server);
    await booster.sync.start();
    await flush();
    const before = booster.tokenRequests;
    for (let i = 0; i < 5; i++) await booster.clients[0].accessToken();
    expect(booster.tokenRequests).toBe(before);
  });

  it("switching conversations cleans up the old subscription and uses one channel per chat", async () => {
    const first = makeParticipant("booster", broker, server);
    await first.sync.start();
    await flush();
    expect(broker.subscribers.size).toBe(1);
    expect(first.clients[0].channels).toHaveLength(1);

    await first.sync.stop();
    expect(broker.subscribers.size).toBe(0);
    expect(first.clients[0].disconnected).toBe(true);

    // Events after unmount are ignored; no resubscribe timers survive.
    server.send("customer", "after unmount");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(first.messages).toHaveLength(0);
    expect(broker.subscribers.size).toBe(0);

    const second = makeParticipant("booster", broker, server);
    await second.sync.start();
    await flush();
    expect(broker.subscribers.size).toBe(1);
  });

  it("subscribes to a private channel only", async () => {
    const booster = makeParticipant("booster", broker, server);
    await booster.sync.start();
    await flush();
    const [ch] = booster.clients[0].channels;
    expect(ch.isPrivate).toBe(true);
    expect(ch.topic).toBe(TOPIC);
  });

  it("ignores broadcasts for another order arriving on the channel", async () => {
    const booster = makeParticipant("booster", broker, server);
    await booster.sync.start();
    await flush();
    const [ch] = booster.clients[0].channels;
    ch.handlers.get("chat.message.created")?.({
      payload: { messageId: "x", orderId: "someone-else", content: "nope", createdAt: new Date().toISOString() },
    });
    expect(booster.messages).toHaveLength(0);
  });
});
