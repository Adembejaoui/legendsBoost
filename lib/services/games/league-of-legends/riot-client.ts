// Server-only module: never import from a "use client" file.
import type { ZodType } from "zod";
import { getRiotApiKey, getRiotCapabilities } from "./capabilities";
import { isAllowedRiotHost } from "./routing";
import { createMemoryRiotLimiter, type RiotLimiter } from "./rate-limiter";

/**
 * Minimal server-only Riot API client.
 *
 *  - The API key is read from server env and sent only in the X-Riot-Token
 *    header; it is never logged or returned.
 *  - Only hosts from the closed routing table are reachable.
 *  - Every request first reserves a slot in the limiter (shared across
 *    instances in production; see rate-limiter.ts).
 *  - 429: the host is put in a shared cooldown for Retry-After ("halt future
 *    API calls for the duration ... indicated by the Retry-After header").
 *    Short waits are retried once or twice; long ones fail fast.
 *  - 5xx / network errors: bounded exponential backoff (2 retries).
 *  - Responses can be validated against a zod schema; mismatches are errors.
 *  - Failures are logged as structured diagnostics without key material.
 */

/** What went wrong, for diagnostics. Users only ever see safe messages. */
export type RiotErrorKind =
  | "missing_key" // no key configured
  | "unauthorized" // 401: request carried no usable credentials
  | "forbidden" // 403: invalid key, expired development key or endpoint not permitted
  | "rate_limited" // 429 or local limiter
  | "not_found" // 404
  | "bad_request" // 400
  | "network" // could not reach Riot / timeout
  | "outage" // 5xx after retries
  | "invalid_response" // body did not match the expected schema
  | "disallowed"; // host/path rejected locally

export class RiotApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly kind: RiotErrorKind = status === 400 ? "bad_request" : "outage"
  ) {
    super(message);
    this.name = "RiotApiError";
  }
}
export class RiotNotFoundError extends RiotApiError {
  constructor() {
    super("Not found on Riot", 404, "not_found");
    this.name = "RiotNotFoundError";
  }
}
export class RiotRateLimitedError extends RiotApiError {
  constructor(public readonly retryAfterSec: number) {
    super(`Riot API rate limit reached; retry in ${retryAfterSec}s`, 429, "rate_limited");
    this.name = "RiotRateLimitedError";
  }
}
export class RiotUnavailableError extends RiotApiError {
  constructor(message = "Riot API is not available", kind: RiotErrorKind = "network", status: number | null = null) {
    super(message, status, kind);
    this.name = "RiotUnavailableError";
  }
}
/** 401 / 403. Riot makes "no distinction" between an invalid path and invalid credentials on 403. */
export class RiotAuthError extends RiotApiError {
  constructor(status: 401 | 403) {
    super(
      status === 401 ? "Riot API request was not authenticated" : "Riot API rejected the key for this endpoint",
      status,
      status === 401 ? "unauthorized" : "forbidden"
    );
    this.name = "RiotAuthError";
  }
}
export class RiotBadRequestError extends RiotApiError {
  constructor() {
    super("Riot API rejected the request parameters", 400, "bad_request");
    this.name = "RiotBadRequestError";
  }
}
export class RiotInvalidResponseError extends RiotApiError {
  constructor() {
    super("Riot API returned an unexpected response", null, "invalid_response");
    this.name = "RiotInvalidResponseError";
  }
}

export interface RiotLogEntry {
  event: "riot_api_error";
  kind: RiotErrorKind;
  status: number | null;
  /** e.g. account-v1, league-v4, match-v5, summoner-v4 */
  endpointFamily: string;
  /** Routing host (identifies the region/platform). */
  host: string;
  correlationId: string | null;
  orderId: string | null;
  rateLimitType?: string | null;
  hint?: string;
}

export interface RiotClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  apiKey: () => string | null;
  limiter: RiotLimiter;
  log: (entry: RiotLogEntry) => void;
  /** Used only for the 403 diagnostic hint. */
  keyTier: () => string;
}

export interface RiotRequestOptions<T = unknown> {
  query?: Record<string, string | number | undefined>;
  /** Cache successful responses for this long (ms). 0 = no cache. */
  cacheTtlMs?: number;
  maxRetries?: number;
  /** Validate the JSON body; a mismatch throws RiotInvalidResponseError. */
  schema?: ZodType<T>;
  /** Diagnostics context (never sent to Riot). */
  correlationId?: string;
  orderId?: string;
}

const MAX_INLINE_RETRY_AFTER_SEC = 5;
/** Wait at most this long in-process for a local limiter slot. */
const MAX_INLINE_LIMITER_WAIT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_MAX_ENTRIES = 500;

export function endpointFamily(path: string): string {
  const m = /^\/(?:lol|riot)\/([a-z-]+)\/(v\d+)\//.exec(path);
  return m ? `${m[1]}-${m[2]}` : "unknown";
}

function defaultLog(entry: RiotLogEntry) {
  // Structured, secret-free diagnostics (status, family, host, ids only).
  console.warn(JSON.stringify(entry));
}

export function createRiotClient(deps: Partial<RiotClientDeps> = {}) {
  const now = deps.now ?? (() => Date.now());
  const d: RiotClientDeps = {
    fetch: deps.fetch ?? ((...a) => fetch(...a)),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now,
    apiKey: deps.apiKey ?? (() => getRiotApiKey()),
    limiter: deps.limiter ?? createMemoryRiotLimiter({ now }),
    log: deps.log ?? defaultLog,
    keyTier: deps.keyTier ?? (() => getRiotCapabilities().keyTier),
  };
  const cache = new Map<string, { expires: number; value: unknown }>();

  async function get<T>(host: string, path: string, opts: RiotRequestOptions<T> = {}): Promise<T> {
    if (!isAllowedRiotHost(host)) throw new RiotUnavailableError("Disallowed Riot host", "disallowed");
    if (!path.startsWith("/")) throw new RiotUnavailableError("Invalid Riot path", "disallowed");
    const key = d.apiKey();
    if (!key) throw new RiotUnavailableError("Riot API key not configured", "missing_key");

    const url = new URL(`https://${host}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const cacheKey = url.toString();
    const ttl = opts.cacheTtlMs ?? 0;
    if (ttl > 0) {
      const hit = cache.get(cacheKey);
      if (hit && hit.expires > d.now()) return hit.value as T;
    }

    const family = endpointFamily(path);
    const fail = (error: RiotApiError, extra: Partial<RiotLogEntry> = {}): never => {
      d.log({
        event: "riot_api_error",
        kind: error.kind,
        status: error.status,
        endpointFamily: family,
        host,
        correlationId: opts.correlationId ?? null,
        orderId: opts.orderId ?? null,
        ...extra,
      });
      throw error;
    };

    const maxRetries = opts.maxRetries ?? 2;
    let attempt = 0;
    let limiterWaits = 0;
    for (;;) {
      let wait: number;
      try {
        wait = await d.limiter.acquire(host);
      } catch {
        // Fail closed: without the shared limiter no call is made.
        return fail(new RiotUnavailableError("Riot rate limiter unavailable", "network"));
      }
      if (wait > 0) {
        if (wait <= MAX_INLINE_LIMITER_WAIT_MS && limiterWaits < 3) {
          limiterWaits++;
          await d.sleep(wait);
          continue;
        }
        // Expected back-pressure, not an error worth logging.
        throw new RiotRateLimitedError(Math.max(1, Math.ceil(wait / 1000)));
      }

      let res: Response;
      try {
        res = await d.fetch(url, {
          headers: { "X-Riot-Token": key, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt < maxRetries) {
          await d.sleep(500 * 2 ** attempt++);
          continue;
        }
        return fail(new RiotUnavailableError("Could not reach the Riot API", "network"));
      }

      if (res.ok) {
        let value: T;
        try {
          const json: unknown = await res.json();
          value = opts.schema ? opts.schema.parse(json) : (json as T);
        } catch {
          return fail(new RiotInvalidResponseError());
        }
        if (ttl > 0) {
          if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
          cache.set(cacheKey, { expires: d.now() + ttl, value });
        }
        return value;
      }

      if (res.status === 404) throw new RiotNotFoundError(); // an answer, not a fault
      if (res.status === 400) return fail(new RiotBadRequestError());
      if (res.status === 401 || res.status === 403) {
        const hint =
          res.status === 401
            ? "No credentials reached Riot: check RIOT_API_KEY."
            : d.keyTier() === "development"
              ? "Key rejected: development keys deactivate every 24 hours (regenerate it), or the key is invalid / not permitted for this endpoint."
              : "Key rejected: invalid key, revoked key, or this endpoint is not permitted for the product.";
        return fail(new RiotAuthError(res.status), { hint });
      }
      if (res.status === 429) {
        const retryAfter = Math.max(1, Number(res.headers.get("Retry-After")) || 1);
        // Shared cooldown first, so other instances stop too.
        await d.limiter.block(host, retryAfter).catch(() => {});
        if (retryAfter <= MAX_INLINE_RETRY_AFTER_SEC && attempt < maxRetries) {
          attempt++;
          await d.sleep(retryAfter * 1000);
          continue;
        }
        return fail(new RiotRateLimitedError(retryAfter), { rateLimitType: res.headers.get("X-Rate-Limit-Type") });
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await d.sleep(500 * 2 ** attempt++);
        continue;
      }
      return fail(
        res.status >= 500
          ? new RiotUnavailableError(`Riot API error (${res.status})`, "outage", res.status)
          : new RiotApiError(`Riot API error (${res.status})`, res.status)
      );
    }
  }

  return { get, _cache: cache };
}

export type RiotClient = ReturnType<typeof createRiotClient>;

// The process-wide client with the shared (database) limiter lives in
// shared-client.ts so this module stays free of database imports.
