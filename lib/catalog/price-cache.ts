// Server-only module.
/**
 * 60-second cache for the public catalog's price data (stress test
 * 2026-11-22): the game and service pages stay dynamic (the header knows who
 * is signed in) but no longer query the database on every visit.
 *
 *  - Cached results expire after CATALOG_CACHE_SECONDS.
 *  - Any price or commission change clears the tag at once
 *    (`invalidateCatalogPrices`, called by lib/pricing/admin.service.ts).
 *  - A database failure is never cached: the cached function throws, and
 *    the caller falls back to a live read (which degrades gracefully).
 *  - Outside a Next.js server (scripts, tests) there is no cache: the live
 *    function runs directly.
 * The quote API and checkout never use this cache: they always read the
 * active price, so a customer is always charged the current price.
 */
import { revalidateTag, unstable_cache } from "next/cache";
import { logger } from "@/lib/logger";

export const CATALOG_PRICES_TAG = "catalog-prices";
export const CATALOG_CACHE_SECONDS = 60;

/**
 * Wrap `strict` (throws on failure, returns JSON-safe data) in the cache;
 * on any error, `fallback` (never throws) answers from a live read.
 */
export function cachedCatalog<A extends unknown[], R>(
  name: string,
  strict: (...args: A) => Promise<R>,
  fallback: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  const cached = unstable_cache(strict, [`catalog:${name}`], { tags: [CATALOG_PRICES_TAG], revalidate: CATALOG_CACHE_SECONDS });
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch {
      return fallback(...args);
    }
  };
}

/** A price or the commission changed: the next visit reads fresh prices. */
export function invalidateCatalogPrices(): void {
  try {
    revalidateTag(CATALOG_PRICES_TAG, { expire: 0 });
  } catch (e) {
    // Outside a Next.js request (scripts): the cache expires on its own within a minute.
    logger.warn("Catalog price cache not cleared", { error: e instanceof Error ? e.message : "unknown" });
  }
}
