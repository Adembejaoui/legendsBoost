/**
 * Order chat realtime synchronization (browser side, framework-agnostic).
 *
 * Responsibilities:
 *  - Obtain a short-lived, topic-scoped Realtime JWT from `/api/realtime/auth`
 *    (server authorizes the order with Prisma before signing) and refresh it
 *    periodically, so lost access is re-checked within minutes.
 *  - Join exactly one private Broadcast channel `private-order:{orderId}`.
 *  - On every successful (re)subscribe, run a catch-up fetch of messages
 *    created since the newest message already shown. Because the channel is
 *    live *before* the fetch starts, nothing can fall into the gap between
 *    "history loaded" and "subscription active", including messages sent while
 *    the browser was offline. Duplicates from the overlap are removed by id.
 *  - Recover from channel errors / timeouts / unexpected closes with backoff.
 *  - Tear everything down on stop() (unmount or conversation switch).
 *
 * The React wrapper lives in components/chat/useOrderChatRealtime.ts.
 */

import { RealtimeClient } from "@supabase/supabase-js";
import { orderChannel } from "@/lib/realtime/channel-names";
import {
  messageFromBroadcast,
  normalizeServerMessage,
  type ChatMessage,
  type ChatMessageCreatedPayload,
  type RawServerMessage,
} from "./message-sync";

export type ChatConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  /** The server refused a token: user no longer belongs to this order. */
  | "unauthorized"
  /** Realtime is not configured in this deployment (missing public env). */
  | "unavailable";

export interface ReadReceiptPayload {
  conversationId: string;
  orderId: string;
  readerId: string;
  readAt: string;
  messageIds: string[];
}

/** Minimal surface of a Realtime channel used here (eases testing). */
export interface ChannelLike {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload?: unknown }) => void): ChannelLike;
  subscribe(cb: (status: string, err?: Error) => void): ChannelLike;
}

/** Minimal surface of a RealtimeClient used here (eases testing). */
export interface RealtimeLike {
  channel(name: string, opts: { config: { private: boolean } }): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
  removeAllChannels(): Promise<unknown>;
  disconnect(): Promise<unknown> | void;
}

export class RealtimeHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "RealtimeHttpError";
  }
}

const isAuthError = (e: unknown) =>
  e instanceof RealtimeHttpError && (e.status === 401 || e.status === 403);

export const ORDER_LIFECYCLE_EVENTS = [
  "order.status_changed",
  "order.completed",
  "order.cancelled",
  "order.reassigned",
  // Anything else on the order (Riot sync, session, login, bid won...).
  "order.updated",
  "order.assigned",
  "order.started",
] as const;
export type OrderLifecycleEvent = (typeof ORDER_LIFECYCLE_EVENTS)[number];

export interface OrderChatSyncOptions {
  orderId: string;
  /** Build the Realtime client. `accessToken` is called on connect + every heartbeat. */
  createClient: (accessToken: () => Promise<string>) => RealtimeLike;
  /** POST /api/realtime/auth. Must throw RealtimeHttpError on HTTP errors. */
  fetchToken: (channel: string) => Promise<{ token: string; expiresInMs: number }>;
  /** GET messages created at/after `after` (oldest first). Throw RealtimeHttpError on HTTP errors. */
  fetchSince: (after: string | null) => Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  /** Newest confirmed message timestamp currently displayed. */
  getCursor: () => string | null;
  onMessages: (messages: ChatMessage[]) => void;
  onRead?: (payload: ReadReceiptPayload) => void;
  onState: (state: ChatConnectionState) => void;
  /** Called for each message pushed by another participant. */
  onIncoming?: (message: ChatMessage) => void;
  /**
   * Order lifecycle broadcast on the same private channel (status change,
   * completion, cancellation, reassignment). Lets the workspace refresh as
   * soon as the other participant pauses / resumes / completes.
   */
  onOrderEvent?: (event: OrderLifecycleEvent, payload: { orderId: string; newStatus?: string }) => void;
  isOnline?: () => boolean;
  now?: () => number;
  log?: (msg: string, detail?: unknown) => void;
}

/** Re-request the token (re-running server authorization) at most this often. */
export const TOKEN_REFRESH_AFTER_MS = 4 * 60 * 1000;
export const RESUBSCRIBE_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const MAX_CATCH_UP_PAGES = 10;

export class OrderChatSync {
  readonly channelName: string;
  private client: RealtimeLike | null = null;
  private channel: ChannelLike | null = null;
  private stopped = false;
  private state: ChatConnectionState | null = null;

  private token: string | null = null;
  private tokenIssuedAt = 0;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;

  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private catchUpRunning: Promise<void> | null = null;
  private catchUpQueued = false;

  private readonly now: () => number;
  private readonly log: (msg: string, detail?: unknown) => void;

  constructor(private readonly opts: OrderChatSyncOptions) {
    this.channelName = orderChannel(opts.orderId);
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? (() => {});
  }

  async start(): Promise<void> {
    if (this.client || this.stopped) return;
    this.setState("connecting");
    try {
      // Fail fast (and show "unauthorized") before opening a socket.
      await this.getToken();
    } catch (e) {
      if (this.stopped) return;
      if (isAuthError(e)) return; // markUnauthorized already ran
      this.log("initial token fetch failed", e);
      this.setState(this.isOnline() ? "reconnecting" : "offline");
      this.scheduleResubscribe();
      return;
    }
    if (this.stopped) return;
    this.client = this.opts.createClient(() => this.getToken());
    this.join();
  }

  /** Tear down the channel and socket. Safe to call multiple times. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.channel = null;
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.removeAllChannels();
      } catch {
        /* ignore */
      }
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Called when the browser regains connectivity or the tab becomes visible.
   * Resubscribes immediately if not live, otherwise just catches up.
   */
  nudge(): void {
    if (this.stopped || this.state === "unauthorized") return;
    if (this.state === "live") {
      void this.catchUp();
      return;
    }
    this.retryAttempt = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.resubscribe();
  }

  getState(): ChatConnectionState | null {
    return this.state;
  }

  /** Fetch everything newer than the newest displayed message. Single-flight. */
  catchUp(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.catchUpRunning) {
      this.catchUpQueued = true;
      return this.catchUpRunning;
    }
    this.catchUpRunning = (async () => {
      try {
        do {
          this.catchUpQueued = false;
          for (let page = 0; page < MAX_CATCH_UP_PAGES && !this.stopped; page++) {
            const { messages, hasMore } = await this.opts.fetchSince(this.opts.getCursor());
            if (this.stopped) return;
            if (messages.length) this.opts.onMessages(messages);
            if (!hasMore) break;
          }
        } while (this.catchUpQueued && !this.stopped);
      } catch (e) {
        if (isAuthError(e)) this.markUnauthorized();
        else this.log("catch-up failed", e);
      } finally {
        this.catchUpRunning = null;
      }
    })();
    return this.catchUpRunning;
  }

  // ---------------------------------------------------------------- internals

  private isOnline(): boolean {
    return this.opts.isOnline ? this.opts.isOnline() : true;
  }

  private setState(state: ChatConnectionState) {
    if (this.state === state) return;
    // "unauthorized" is terminal.
    if (this.state === "unauthorized") return;
    this.state = state;
    this.opts.onState(state);
  }

  private join() {
    if (!this.client || this.stopped) return;
    const channel = this.client.channel(this.channelName, { config: { private: true } });
    this.channel = channel;

    channel
      .on("broadcast", { event: "chat.message.created" }, (msg) => {
        if (this.channel !== channel) return;
        const p = msg?.payload as ChatMessageCreatedPayload | undefined;
        if (!p || typeof p.messageId !== "string" || p.orderId !== this.opts.orderId) return;
        const message = messageFromBroadcast(p);
        this.opts.onMessages([message]);
        this.opts.onIncoming?.(message);
      })
      .on("broadcast", { event: "chat.message.read" }, (msg) => {
        if (this.channel !== channel) return;
        const p = msg?.payload as ReadReceiptPayload | undefined;
        if (!p || p.orderId !== this.opts.orderId || !Array.isArray(p.messageIds)) return;
        this.opts.onRead?.(p);
      });

    for (const name of ORDER_LIFECYCLE_EVENTS) {
      channel.on("broadcast", { event: name }, (msg) => {
        if (this.channel !== channel) return;
        const p = msg?.payload as { orderId?: unknown; newStatus?: unknown } | undefined;
        if (!p || p.orderId !== this.opts.orderId) return;
        this.opts.onOrderEvent?.(name, {
          orderId: this.opts.orderId,
          newStatus: typeof p.newStatus === "string" ? p.newStatus : undefined,
        });
      });
    }

    channel
      .subscribe((status, err) => {
        if (this.stopped || this.channel !== channel) return;
        if (status === "SUBSCRIBED") {
          this.retryAttempt = 0;
          this.setState("live");
          void this.catchUp();
          return;
        }
        // CHANNEL_ERROR, TIMED_OUT or an unexpected CLOSED (e.g. the server
        // closing the channel when a token expires). Replace the channel
        // ourselves so retries always carry a fresh, re-authorized token.
        this.log(`channel ${status}`, err?.message);
        const authProblem = /unauthori[sz]ed|permission|jwt|token/i.test(err?.message ?? "");
        if (authProblem) this.tokenIssuedAt = 0; // force a refresh on retry
        this.setState(this.isOnline() ? "reconnecting" : "offline");
        this.scheduleResubscribe();
      });
  }

  private scheduleResubscribe() {
    if (this.stopped || this.retryTimer) return;
    const delay =
      RESUBSCRIBE_BACKOFF_MS[Math.min(this.retryAttempt, RESUBSCRIBE_BACKOFF_MS.length - 1)];
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.resubscribe();
    }, delay);
  }

  private async resubscribe() {
    if (this.stopped) return;
    const old = this.channel;
    this.channel = null;
    if (old && this.client) {
      try {
        await this.client.removeChannel(old);
      } catch {
        /* ignore */
      }
    }
    try {
      await this.getToken();
    } catch (e) {
      if (this.stopped || isAuthError(e)) return;
      this.setState(this.isOnline() ? "reconnecting" : "offline");
      this.scheduleResubscribe();
      return;
    }
    if (this.stopped) return;
    if (!this.client) this.client = this.opts.createClient(() => this.getToken());
    this.join();
  }

  private markUnauthorized() {
    if (this.state === "unauthorized") return;
    this.setState("unauthorized");
    void this.stop();
  }

  /**
   * Cached token getter used for the initial join and by realtime-js on every
   * heartbeat. Re-requests the token (and therefore re-runs server-side order
   * authorization) once it is older than TOKEN_REFRESH_AFTER_MS.
   */
  private getToken(): Promise<string> {
    const now = this.now();
    const lifetime = this.tokenExpiresAt - this.tokenIssuedAt;
    const refreshAt = this.tokenIssuedAt + Math.min(TOKEN_REFRESH_AFTER_MS, lifetime * 0.75);
    if (this.token && now < refreshAt) return Promise.resolve(this.token);
    if (this.tokenPromise) return this.tokenPromise;

    this.tokenPromise = (async () => {
      try {
        const { token, expiresInMs } = await this.opts.fetchToken(this.channelName);
        const issued = this.now();
        this.token = token;
        this.tokenIssuedAt = issued;
        this.tokenExpiresAt = issued + expiresInMs;
        return token;
      } catch (e) {
        if (isAuthError(e)) {
          this.markUnauthorized();
          throw e;
        }
        // Transient failure: keep using the current token while it is valid.
        if (this.token && this.now() < this.tokenExpiresAt - 5_000) return this.token;
        throw e;
      } finally {
        this.tokenPromise = null;
      }
    })();
    return this.tokenPromise;
  }
}

// ------------------------------------------------------------ browser wiring

/** Browser Realtime client for one chat. Uses only public (anon) credentials. */
export function createBrowserRealtimeClient(
  accessToken: () => Promise<string>
): RealtimeLike | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const endpoint = `${url.replace(/\/+$/, "").replace(/^http/, "ws")}/realtime/v1`;
  return new RealtimeClient(endpoint, {
    params: { apikey: anonKey },
    accessToken,
  }) as unknown as RealtimeLike;
}

export async function fetchRealtimeToken(
  channel: string
): Promise<{ token: string; expiresInMs: number }> {
  const res = await fetch("/api/realtime/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) {
    throw new RealtimeHttpError(res.status, data?.message ?? "Realtime auth failed");
  }
  return { token: data.token, expiresInMs: Number(data.expiresInMs) || 15 * 60 * 1000 };
}

export function createMessageFetcher(orderId: string, isVisible: () => boolean) {
  return async (after: string | null) => {
    const qs = new URLSearchParams({ limit: after ? "100" : "50" });
    if (after) qs.set("after", after);
    // Only mark messages read when the user can actually see the chat.
    if (!isVisible()) qs.set("markRead", "false");
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/messages?${qs}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) throw new RealtimeHttpError(res.status, "Failed to load messages");
    const data = await res.json();
    const messages: ChatMessage[] = ((data.messages ?? []) as RawServerMessage[]).map(normalizeServerMessage);
    return { messages, hasMore: Boolean(after && data.hasMore) };
  };
}
