import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
import { clientIp, sharedRateLimit, type RawQueryClient } from "@/lib/security/shared-rate-limit";

function fakeDb() {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const db: RawQueryClient = {
    $queryRaw: (async (_q: TemplateStringsArray, ...values: unknown[]) => {
      const key = values.find((v) => typeof v === "string" && v.startsWith("app:")) as string;
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return [{ count: n, waitMs: 30_000 }];
    }) as RawQueryClient["$queryRaw"],
    $executeRaw: (async () => 0) as RawQueryClient["$executeRaw"],
  };
  return { db, keys };
}

describe("sharedRateLimit", () => {
  it("allows up to max, then refuses with a retry delay", async () => {
    const { db } = fakeDb();
    const lim = { max: 2, windowSec: 60 };
    expect((await sharedRateLimit("login-email", "a@b.c", lim, db)).success).toBe(true);
    expect((await sharedRateLimit("login-email", "a@b.c", lim, db)).success).toBe(true);
    expect(await sharedRateLimit("login-email", "a@b.c", lim, db)).toEqual({ success: false, retryAfterSec: 30 });
  });

  it("never stores the raw identifier (hashed key) and separates scopes", async () => {
    const { db, keys } = fakeDb();
    await sharedRateLimit("login-email", "victim@example.com", { max: 5, windowSec: 60 }, db);
    await sharedRateLimit("register-ip", "victim@example.com", { max: 5, windowSec: 60 }, db);
    expect(keys[0]).not.toContain("victim");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("falls back to the in-memory limiter when the database fails", async () => {
    const broken: RawQueryClient = {
      $queryRaw: (async () => {
        throw new Error("db down");
      }) as RawQueryClient["$queryRaw"],
      $executeRaw: (async () => 0) as RawQueryClient["$executeRaw"],
    };
    const lim = { max: 1, windowSec: 60 };
    expect((await sharedRateLimit("t", "fallback-id", lim, broken)).success).toBe(true);
    expect((await sharedRateLimit("t", "fallback-id", lim, broken)).success).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientIp({ "x-forwarded-for": "4.4.4.4" })).toBe("4.4.4.4");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
