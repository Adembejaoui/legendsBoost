// @vitest-environment node
/**
 * Catalog price cache (stress test 2026-11-22): cached reads for the public
 * pages, never caching a failure, and a cache clear that cannot break a
 * price change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  cacheWorks: true,
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[]) => async (...args: unknown[]) => {
    if (!h.cacheWorks) throw new Error("Invariant: incrementalCache missing");
    const key = JSON.stringify([keyParts, args]);
    if (h.store.has(key)) return h.store.get(key);
    const v = await fn(...args); // a throw here is not stored
    h.store.set(key, v);
    return v;
  },
  revalidateTag: h.revalidateTag,
}));

import { cachedCatalog, invalidateCatalogPrices, CATALOG_PRICES_TAG } from "@/lib/catalog/price-cache";

beforeEach(() => {
  h.store.clear();
  h.cacheWorks = true;
  h.revalidateTag.mockReset();
});

describe("catalog price cache", () => {
  it("serves repeated reads from the cache", async () => {
    const strict = vi.fn(async (g: string): Promise<{ game: string; price: number | null }> => ({ game: g, price: 600 }));
    const fallback = vi.fn(async (g: string) => ({ game: g, price: null }));
    const read = cachedCatalog("t1", strict, fallback);
    expect(await read("lol")).toEqual({ game: "lol", price: 600 });
    expect(await read("lol")).toEqual({ game: "lol", price: 600 });
    expect(strict).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("never caches a database failure: the live fallback answers, the next visit tries again", async () => {
    let down = true;
    const strict = vi.fn(async (): Promise<{ price: number | null }> => {
      if (down) throw new Error("db down");
      return { price: 600 };
    });
    const read = cachedCatalog("t2", strict, async () => ({ price: null }));
    expect(await read()).toEqual({ price: null });
    down = false;
    expect(await read()).toEqual({ price: 600 });
  });

  it("outside Next.js (scripts, tests) it reads live", async () => {
    h.cacheWorks = false;
    const read = cachedCatalog("t3", async () => "cached", async () => "live");
    expect(await read()).toBe("live");
  });

  it("a price change clears the tag at once and never throws", () => {
    invalidateCatalogPrices();
    expect(h.revalidateTag).toHaveBeenCalledWith(CATALOG_PRICES_TAG, { expire: 0 });
    h.revalidateTag.mockImplementation(() => {
      throw new Error("static generation store missing");
    });
    expect(() => invalidateCatalogPrices()).not.toThrow();
  });
});
