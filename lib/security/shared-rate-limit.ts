// Server-only module: never import from a "use client" file.
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { rateLimit as memoryRateLimit } from "@/lib/rate-limit";

/**
 * Rate limiter shared by every server instance (Vercel runs many).
 *
 * The in-memory limiter in lib/rate-limit.ts only counts requests that hit
 * the same instance, so on serverless an attacker spread over instances is
 * barely slowed. This one keeps fixed-window counters in Postgres, in the
 * existing generic `riotApiThrottle` table (key / windowStart / count), under
 * an "app:" key prefix so it never collides with the Riot API counters.
 *
 *  - Identifiers (emails, IPs) are SHA-256 hashed: no personal data is stored.
 *  - One atomic upsert per check; no read-modify-write race.
 *  - If the database is unreachable it falls back to the in-memory limiter
 *    (fail-soft: never locks every user out because of a DB blip).
 *
 * Use it for security-sensitive endpoints (login, registration, payments,
 * credential reveal). Cheap, high-volume UI throttles can keep lib/rate-limit.
 */

export interface SharedLimit {
  max: number;
  windowSec: number;
}

export interface SharedLimitResult {
  success: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSec: number;
}

export interface RawQueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

function hashKey(scope: string, identifier: string) {
  const digest = createHash("sha256").update(`${scope}\u0000${identifier}`).digest("base64url").slice(0, 32);
  return `app:${scope}:${digest}`;
}

let warned = false;

export async function sharedRateLimit(
  scope: string,
  identifier: string,
  limit: SharedLimit,
  db: RawQueryClient = prisma as unknown as RawQueryClient
): Promise<SharedLimitResult> {
  const key = hashKey(scope, identifier);
  try {
    const rows = await db.$queryRaw<{ count: number; waitMs: number }[]>`
      WITH w AS (
        SELECT (to_timestamp(floor(EXTRACT(EPOCH FROM clock_timestamp()) / ${limit.windowSec}::int) * ${limit.windowSec}::int) AT TIME ZONE 'UTC') AS ws
      )
      INSERT INTO "riotApiThrottle" ("key", "windowStart", "count", "updatedAt")
      SELECT ${key}, ws, 1, (now() AT TIME ZONE 'UTC') FROM w
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "riotApiThrottle"."windowStart" = EXCLUDED."windowStart"
                       THEN "riotApiThrottle"."count" + 1 ELSE 1 END,
        "windowStart" = EXCLUDED."windowStart",
        "updatedAt" = (now() AT TIME ZONE 'UTC')
      RETURNING "count",
        (EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${limit.windowSec}::float8))) * 1000
          - EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::float8 AS "waitMs"`;
    const row = rows[0];
    // Opportunistic cleanup of stale app counters (~1% of calls).
    if (Math.random() < 0.01) {
      void db
        .$executeRaw`DELETE FROM "riotApiThrottle" WHERE "key" LIKE 'app:%' AND "updatedAt" < (now() AT TIME ZONE 'UTC') - interval '2 days'`
        .catch(() => {});
    }
    if (row && Number(row.count) > limit.max) {
      return { success: false, retryAfterSec: Math.max(1, Math.ceil(Number(row.waitMs) / 1000)) };
    }
    return { success: true, retryAfterSec: 0 };
  } catch (e) {
    if (!warned) {
      warned = true;
      logger.error("Shared rate limiter unavailable; using per-instance fallback", {
        error: e instanceof Error ? e.name : "unknown",
      });
    }
    const r = memoryRateLimit(key, { windowMs: limit.windowSec * 1000, maxRequests: limit.max });
    return { success: r.success, retryAfterSec: r.success ? 0 : Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000)) };
  }
}

/**
 * Best-effort client IP. On Vercel `x-real-ip` / the first `x-forwarded-for`
 * entry are set by the platform. Only used as a rate-limit key.
 */
export function clientIp(headers: Headers | Record<string, string | string[] | undefined> | undefined | null): string {
  if (!headers) return "unknown";
  const get = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
    const v = (headers as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
  };
  const real = get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}

/** Limits used across the app, in one place. */
export const LIMITS = {
  loginPerEmail: { max: 8, windowSec: 15 * 60 },
  loginPerIp: { max: 30, windowSec: 15 * 60 },
  registerPerIp: { max: 5, windowSec: 60 * 60 },
  checkoutPerUser: { max: 10, windowSec: 60 },
  credentialRevealPerUser: { max: 20, windowSec: 60 * 60 },
  credentialSavePerUser: { max: 10, windowSec: 60 },
  // Phase 9: sensitive actions, per user (scripts and abuse).
  bidPerUser: { max: 30, windowSec: 60 },
  claimPerUser: { max: 10, windowSec: 60 },
  payoutRequestPerUser: { max: 5, windowSec: 60 * 60 },
  payoutMethodPerUser: { max: 5, windowSec: 60 * 60 },
  reviewPerUser: { max: 10, windowSec: 60 * 60 },
  tipPerUser: { max: 10, windowSec: 60 * 60 },
  cancellationRequestPerUser: { max: 5, windowSec: 60 * 60 },
  sessionPerUser: { max: 30, windowSec: 60 * 60 },
  accountDeletionPerUser: { max: 3, windowSec: 60 * 60 },
  // Production audit: limits that must hold across server instances
  // (they protect the Riot API budget and public endpoints).
  quotePerClient: { max: 60, windowSec: 60 },
  realtimeAuthPerIp: { max: 30, windowSec: 60 },
  riotIdCheckPerUser: { max: 15, windowSec: 60 },
  riotCheckPerUser: { max: 2, windowSec: 30 },
  riotCheckPerOrder: { max: 1, windowSec: 40 },
  riotSyncPerUser: { max: 2, windowSec: 60 },
  riotTestPerUser: { max: 6, windowSec: 60 },
  // Email flows.
  passwordResetPerEmail: { max: 3, windowSec: 60 * 60 },
  passwordResetPerIp: { max: 10, windowSec: 60 * 60 },
  passwordResetSubmitPerIp: { max: 10, windowSec: 15 * 60 },
  verifyEmailPerUser: { max: 3, windowSec: 60 * 60 },
  passwordChangePerUser: { max: 5, windowSec: 60 * 60 },
} as const satisfies Record<string, SharedLimit>;
