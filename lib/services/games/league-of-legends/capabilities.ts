/**
 * Which Riot integrations this deployment is allowed to use.
 *
 * Riot policy (developer.riotgames.com/docs/portal, read 2026-11-12):
 *  - Development keys expire every 24h and "You may not maintain a public
 *    product with a development API key."
 *  - Personal keys: "You may not run your application for public consumption".
 *  - Production keys require an approved product, one product per key.
 *  - Riot Sign On "is only available to developers with Production Level API
 *    Keys" and is set up with Riot after approval.
 *  - General policy: products cannot "create an unfair advantage for players".
 *
 * A boosting service has NOT been confirmed eligible for any of these, so all
 * live Riot data access is OFF unless an operator explicitly declares the
 * product approved (after Riot policy review) or enables local development.
 * Holding an API key is not treated as authorization.
 */

export type RiotKeyTier = "development" | "personal" | "production";

export interface RiotCapabilities {
  /** A key is present in server env (value never leaves the server). */
  apiKeyConfigured: boolean;
  keyTier: RiotKeyTier;
  /** Operator declared the product approved by Riot for this use. */
  productApproved: boolean;
  /** Account-V1 / League-V4 / Match-V5 calls may be made. */
  dataAccess: boolean;
  /** Riot Sign On is available for verified account linking. */
  rso: boolean;
  /** Human-readable explanation shown in the UI when something is off. */
  reason: string | null;
}

type Env = Record<string, string | undefined>;

/**
 * Canonical variable: RIOT_API_KEY (a Riot key belongs to a product, not to
 * one game). RIOT_LOL_API_KEY is still read as a deprecated fallback so
 * existing deployments keep working.
 */
export const RIOT_API_KEY_ENV = "RIOT_API_KEY";
export const RIOT_API_KEY_LEGACY_ENV = "RIOT_LOL_API_KEY";

function usableKey(raw: string | undefined): string | null {
  const key = raw?.trim();
  if (!key || key.startsWith("your_")) return null;
  return key;
}

export function getRiotApiKey(env: Env = process.env): string | null {
  return usableKey(env[RIOT_API_KEY_ENV]) ?? usableKey(env[RIOT_API_KEY_LEGACY_ENV]);
}

/** Which variable supplied the key (for docs/diagnostics; never the value). */
export function getRiotApiKeySource(env: Env = process.env): string | null {
  if (usableKey(env[RIOT_API_KEY_ENV])) return RIOT_API_KEY_ENV;
  if (usableKey(env[RIOT_API_KEY_LEGACY_ENV])) return RIOT_API_KEY_LEGACY_ENV;
  return null;
}

export interface RiotRateLimit {
  max: number;
  windowSec: number;
}

/**
 * Application rate limits per key tier, enforced per routing host (Riot:
 * "rate limits are enforced per region").
 *  - personal / production: Riot Developer Portal (read 2026-11-12):
 *    personal "20 requests every 1 second", "100 requests every 2 minutes";
 *    production "500 requests every 10 seconds", "30,000 requests every 10 minutes".
 *  - development: not published; the personal values are used as a
 *    conservative assumption.
 * The real limits for a key are in its X-App-Rate-Limit response header;
 * RIOT_RATE_LIMITS="20:1,100:120" (max:windowSec,...) overrides these.
 */
const TIER_LIMITS: Record<RiotKeyTier, RiotRateLimit[]> = {
  development: [{ max: 20, windowSec: 1 }, { max: 100, windowSec: 120 }],
  personal: [{ max: 20, windowSec: 1 }, { max: 100, windowSec: 120 }],
  production: [{ max: 500, windowSec: 10 }, { max: 30_000, windowSec: 600 }],
};

/** Keep this share of each limit for this app (headroom for fixed windows). */
const SAFETY_FACTOR = 0.8;

export function getRiotRateLimits(env: Env = process.env): RiotRateLimit[] {
  const override = env.RIOT_RATE_LIMITS?.trim();
  let limits: RiotRateLimit[] | null = null;
  if (override) {
    const parsed = override.split(",").map((part) => {
      const [max, windowSec] = part.split(":").map((n) => Number(n.trim()));
      return { max, windowSec };
    });
    if (parsed.every((l) => Number.isInteger(l.max) && l.max > 0 && Number.isInteger(l.windowSec) && l.windowSec > 0)) {
      limits = parsed;
    }
  }
  limits ??= TIER_LIMITS[resolveKeyTier(env)];
  return limits.map((l) => ({ max: Math.max(1, Math.floor(l.max * SAFETY_FACTOR)), windowSec: l.windowSec }));
}

function resolveKeyTier(env: Env): RiotKeyTier {
  const tierRaw = (env.RIOT_API_KEY_TIER ?? "development").toLowerCase();
  return tierRaw === "production" || tierRaw === "personal" ? tierRaw : "development";
}

export function getRiotCapabilities(env: Env = process.env): RiotCapabilities {
  const apiKeyConfigured = getRiotApiKey(env) !== null;
  const keyTier = resolveKeyTier(env);
  const productApproved = env.RIOT_PRODUCT_APPROVED === "true";
  const isProductionRuntime = env.NODE_ENV === "production";
  const localDevAllowed = env.RIOT_ALLOW_DEV_KEY_LOCAL === "true" && !isProductionRuntime;

  let dataAccess = false;
  let reason: string | null = null;

  if (!apiKeyConfigured) {
    reason = "Riot API integration is not configured.";
  } else if (keyTier === "production" && productApproved) {
    dataAccess = true;
  } else if (localDevAllowed) {
    dataAccess = true;
    reason = "Local development mode: Riot data uses a development key and must not be used publicly.";
  } else if (!productApproved) {
    reason = "Official Riot integration is pending Riot product approval.";
  } else {
    reason = "A production Riot API key is required for public use.";
  }

  // RSO requires a production key, Riot approval and an RSO client. The OAuth
  // flow is intentionally not implemented until Riot onboards the product.
  const rso = false;

  return { apiKeyConfigured, keyTier, productApproved, dataAccess, rso, reason };
}

/** Browser-safe projection (no key material, no tier internals). */
export function publicRiotCapabilities(caps: RiotCapabilities) {
  return {
    dataAccess: caps.dataAccess,
    rso: caps.rso,
    reason: caps.reason,
  };
}
export type PublicRiotCapabilities = ReturnType<typeof publicRiotCapabilities>;
