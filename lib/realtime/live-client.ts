/**
 * Browser side of live page signals (framework-agnostic).
 *
 * One LiveChannel = one private Realtime topic with its own short-lived token
 * (POST /api/realtime/auth authorizes the topic on the server). It calls
 * onSignal for every listed event, reports whether it is live, and recovers
 * from errors with backoff. Signals carry no data; the page refetches.
 */
import {
  RESUBSCRIBE_BACKOFF_MS,
  RealtimeHttpError,
  TOKEN_REFRESH_AFTER_MS,
  type ChannelLike,
  type RealtimeLike,
} from "@/lib/chat/realtime-sync";

export type LiveState = "connecting" | "live" | "down" | "unauthorized";

export interface LiveChannelOptions {
  channel: string;
  events: readonly string[];
  createClient: (accessToken: () => Promise<string>) => RealtimeLike | null;
  fetchToken: (channel: string) => Promise<{ token: string; expiresInMs: number }>;
  onSignal: (event: string, payload: unknown) => void;
  onState: (state: LiveState) => void;
  now?: () => number;
}

const isAuthError = (e: unknown) => e instanceof RealtimeHttpError && (e.status === 401 || e.status === 403);

export class LiveChannel {
  private client: RealtimeLike | null = null;
  private channel: ChannelLike | null = null;
  private stopped = false;
  private state: LiveState | null = null;
  private token: string | null = null;
  private tokenIssuedAt = 0;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: LiveChannelOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    if (this.client || this.stopped) return;
    this.setState("connecting");
    try {
      await this.getToken();
    } catch (e) {
      if (this.stopped || isAuthError(e)) return;
      this.setState("down");
      this.scheduleRetry();
      return;
    }
    if (this.stopped) return;
    this.client = this.opts.createClient(() => this.getToken());
    if (!this.client) {
      this.setState("down");
      return;
    }
    this.join();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.channel = null;
    const client = this.client;
    this.client = null;
    if (client) {
      await Promise.resolve(client.removeAllChannels()).catch(() => {});
      await Promise.resolve(client.disconnect()).catch(() => {});
    }
  }

  /** Reconnect now (tab visible again / back online). */
  nudge(): void {
    if (this.stopped || this.state === "live" || this.state === "unauthorized") return;
    this.retryAttempt = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.resubscribe();
  }

  private setState(state: LiveState) {
    if (this.state === state || this.state === "unauthorized") return;
    this.state = state;
    this.opts.onState(state);
  }

  private join() {
    if (!this.client || this.stopped) return;
    const channel = this.client.channel(this.opts.channel, { config: { private: true } });
    this.channel = channel;
    for (const event of this.opts.events) {
      channel.on("broadcast", { event }, (msg) => {
        if (this.channel !== channel) return;
        this.opts.onSignal(event, msg?.payload);
      });
    }
    channel.subscribe((status, err) => {
      if (this.stopped || this.channel !== channel) return;
      if (status === "SUBSCRIBED") {
        const wasDown = this.state !== "connecting" && this.state !== "live";
        this.retryAttempt = 0;
        this.setState("live");
        // Anything may have changed while disconnected: refetch once.
        if (wasDown) this.opts.onSignal("reconnected", null);
        return;
      }
      if (/unauthori[sz]ed|permission|jwt|token/i.test(err?.message ?? "")) this.tokenIssuedAt = 0;
      this.setState("down");
      this.scheduleRetry();
    });
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    const delay = RESUBSCRIBE_BACKOFF_MS[Math.min(this.retryAttempt, RESUBSCRIBE_BACKOFF_MS.length - 1)];
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
    if (old && this.client) await Promise.resolve(this.client.removeChannel(old)).catch(() => {});
    try {
      await this.getToken();
    } catch (e) {
      if (this.stopped || isAuthError(e)) return;
      this.setState("down");
      this.scheduleRetry();
      return;
    }
    if (this.stopped) return;
    if (!this.client) this.client = this.opts.createClient(() => this.getToken());
    if (!this.client) {
      this.setState("down");
      return;
    }
    this.join();
  }

  private getToken(): Promise<string> {
    const now = this.now();
    const lifetime = this.tokenExpiresAt - this.tokenIssuedAt;
    const refreshAt = this.tokenIssuedAt + Math.min(TOKEN_REFRESH_AFTER_MS, lifetime * 0.75);
    if (this.token && now < refreshAt) return Promise.resolve(this.token);
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      try {
        const { token, expiresInMs } = await this.opts.fetchToken(this.opts.channel);
        const issued = this.now();
        this.token = token;
        this.tokenIssuedAt = issued;
        this.tokenExpiresAt = issued + expiresInMs;
        return token;
      } catch (e) {
        if (isAuthError(e)) {
          this.setState("unauthorized");
          void this.stop();
          throw e;
        }
        if (this.token && this.now() < this.tokenExpiresAt - 5_000) return this.token;
        throw e;
      } finally {
        this.tokenPromise = null;
      }
    })();
    return this.tokenPromise;
  }
}
