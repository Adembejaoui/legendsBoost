// Server-only module: never import from a "use client" file.
import { createHash } from "node:crypto";
import type { RiotRateLimit } from "./capabilities";

/**
 * Riot API request limiter.
 *
 * Riot enforces application limits per API key and per routing host, across
 * every instance of the app. On Vercel each serverless instance has its own
 * memory, so the production limiter keeps its counters in Postgres (the
 * existing database, no new infrastructure): one row per
 * (key fingerprint, host, window). Window boundaries and cooldowns use the
 * DATABASE clock so instances with skewed clocks still agree.
 *
 * Fixed windows can admit up to 2x a limit across a boundary, which is why
 * the configured limits already keep a safety margin (capabilities.ts).
 * The limiter fails CLOSED: if the database cannot be reached no Riot call
 * is made.
 */
export interface RiotLimiter {
  /** Reserve one request on `host`. Resolves 0 when allowed, else ms to wait. */
  acquire(host: string): Promise<number>;
  /** Stop all calls to `host` for `retryAfterSec` (HTTP 429 Retry-After). */
  block(host: string, retryAfterSec: number): Promise<void>;
}

/** Truncated SHA-256 of the key: separates keys without storing them. */
export function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

/** In-process limiter: unit tests and single-instance local development. */
export function createMemoryRiotLimiter(opts: { now: () => number; limits?: RiotRateLimit[] }): RiotLimiter {
  const limits = opts.limits ?? [];
  const counters = new Map<string, { windowStart: number; count: number }>();
  const blocked = new Map<string, number>();
  return {
    async acquire(host) {
      const now = opts.now();
      const until = blocked.get(host) ?? 0;
      if (until > now) return until - now;
      let wait = 0;
      for (const l of limits) {
        const ms = l.windowSec * 1000;
        const windowStart = Math.floor(now / ms) * ms;
        const k = `${host}:${l.windowSec}`;
        const c = counters.get(k);
        const count = c && c.windowStart === windowStart ? c.count + 1 : 1;
        counters.set(k, { windowStart, count });
        if (count > l.max) wait = Math.max(wait, windowStart + ms - now);
      }
      return wait;
    },
    async block(host, retryAfterSec) {
      const until = opts.now() + retryAfterSec * 1000;
      blocked.set(host, Math.max(blocked.get(host) ?? 0, until));
    },
  };
}

/** Minimal surface of the Prisma client used here (keeps this testable). */
export interface RawQueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** Shared limiter backed by the `riotApiThrottle` table. */
export function createDbRiotLimiter(opts: {
  db: RawQueryClient;
  apiKey: () => string | null;
  limits: () => RiotRateLimit[];
}): RiotLimiter {
  const prefix = () => {
    const key = opts.apiKey();
    return key ? keyFingerprint(key) : "nokey";
  };
  return {
    async acquire(host) {
      const base = `${prefix()}:${host}`;
      const cooldownKey = `${base}:cooldown`;
      const cd = await opts.db.$queryRaw<{ waitMs: number | null }[]>`
        SELECT (EXTRACT(EPOCH FROM ("blockedUntil" - (clock_timestamp() AT TIME ZONE 'UTC'))) * 1000)::float8 AS "waitMs"
        FROM "riotApiThrottle" WHERE "key" = ${cooldownKey}`;
      const cooldownMs = cd[0]?.waitMs ?? 0;
      if (cooldownMs > 0) return Math.ceil(cooldownMs);

      let wait = 0;
      for (const l of opts.limits()) {
        const key = `${base}:${l.windowSec}`;
        const rows = await opts.db.$queryRaw<{ count: number; waitMs: number }[]>`
          WITH w AS (
            SELECT (to_timestamp(floor(EXTRACT(EPOCH FROM clock_timestamp()) / ${l.windowSec}::int) * ${l.windowSec}::int) AT TIME ZONE 'UTC') AS ws
          )
          INSERT INTO "riotApiThrottle" ("key", "windowStart", "count", "updatedAt")
          SELECT ${key}, ws, 1, (now() AT TIME ZONE 'UTC') FROM w
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE WHEN "riotApiThrottle"."windowStart" = EXCLUDED."windowStart"
                           THEN "riotApiThrottle"."count" + 1 ELSE 1 END,
            "windowStart" = EXCLUDED."windowStart",
            "updatedAt" = (now() AT TIME ZONE 'UTC')
          RETURNING "count",
            (EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${l.windowSec}::float8))) * 1000
              - EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::float8 AS "waitMs"`;
        const row = rows[0];
        if (row && Number(row.count) > l.max) wait = Math.max(wait, Math.ceil(Number(row.waitMs)));
      }
      return wait;
    },
    async block(host, retryAfterSec) {
      const key = `${prefix()}:${host}:cooldown`;
      await opts.db.$queryRaw`
        INSERT INTO "riotApiThrottle" ("key", "windowStart", "count", "blockedUntil", "updatedAt")
        VALUES (${key}, (now() AT TIME ZONE 'UTC'), 0,
                (clock_timestamp() AT TIME ZONE 'UTC') + make_interval(secs => ${retryAfterSec}::float8), (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("key") DO UPDATE SET
          "blockedUntil" = GREATEST(COALESCE("riotApiThrottle"."blockedUntil", EXCLUDED."blockedUntil"), EXCLUDED."blockedUntil"),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
        RETURNING "key"`;
    },
  };
}
