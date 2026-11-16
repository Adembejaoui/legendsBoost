/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  orderFind: vi.fn(),
  accountUpdate: vi.fn(async () => ({})),
  matchFindMany: vi.fn(),
  matchCreateMany: vi.fn(async () => ({ count: 0 })),
  matchCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    order: { findUnique: m.orderFind },
    orderRiotAccount: { update: m.accountUpdate },
    orderMatch: { findMany: m.matchFindMany, createMany: m.matchCreateMany, count: m.matchCount },
  },
}));
vi.mock("@/lib/chat/service", () => ({ getOrCreateConversation: vi.fn(), getMessages: vi.fn() }));

import { getOrderMatchPage } from "@/lib/orders/workspace-data";

// Sync behaviour (work windows, baseline, duplicates, partial progress,
// region checks, PUUID recovery, concurrency) is covered against a stateful
// fake database in __tests__/riot/sync-integrity.test.ts.

beforeEach(() => vi.clearAllMocks());

describe("order match pagination", () => {
  const row = (id: string, orderId = "order-1") => ({
    id,
    orderId,
    matchId: `EUW1_${id}`,
    win: true,
    championId: 1,
    championName: "Annie",
    kills: 1,
    deaths: 0,
    assists: 2,
    cs: 100,
    durationSec: 1500,
    queueId: 420,
    gameStartAt: new Date("2026-11-10T00:00:00Z"),
  });

  it("returns a page and a cursor, scoped to the order", async () => {
    m.matchFindMany.mockResolvedValue([row("m3"), row("m2"), row("m1")]);
    m.matchCount.mockResolvedValue(3);
    const page = await getOrderMatchPage("order-1", { limit: 2, ddragonVersion: null });
    expect(page.matches.map((x) => x.id)).toEqual(["m3", "m2"]);
    expect(page.nextCursor).toBe("m2");
    expect((m.matchFindMany.mock.calls[0] as any)[0].where).toEqual({ orderId: "order-1" });
  });

  it("drops rows from other orders even if a foreign cursor is supplied", async () => {
    m.matchFindMany.mockResolvedValue([row("x1", "order-2")]);
    m.matchCount.mockResolvedValue(0);
    const page = await getOrderMatchPage("order-1", { cursor: "x0", ddragonVersion: null });
    expect(page.matches).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns no puuid or account identifiers", async () => {
    m.matchFindMany.mockResolvedValue([row("m1")]);
    m.matchCount.mockResolvedValue(1);
    const page = await getOrderMatchPage("order-1", { ddragonVersion: null });
    expect(JSON.stringify(page)).not.toMatch(/puuid/i);
  });
});
