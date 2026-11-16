// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
/**
 * Phase 5: games labelled by who played them (booster session / customer /
 * paused), LP change per game from rank snapshots, admin alerts for games
 * outside sessions, and the 15-day retention job. Postgres-backed parts use
 * the in-memory database (all migrations).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock("@/lib/catalog/game-services", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog/game-services")>()),
  getGameServiceOffer: (g: string, s: string) => h.offers.find((o) => o.gameSlug === g && o.serviceSlug === s),
}));
vi.mock("@/lib/config/checkout-options", () => ({
  getCheckoutConfig: (g: string, s: string) => h.checkouts.find((c) => c.gameSlug === g && c.serviceSlug === s),
}));
vi.mock("@/lib/stripe/server", async (orig) => {
  const actual = await orig<typeof import("@/lib/stripe/server")>();
  return { ...actual, getStripe: () => h.stripe.client };
});

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser } from "../support/payment-fixtures";
import {
  attributeMatch,
  boosterWindows,
  classifyGame,
  pauseWindows,
  scanWindows,
  SESSIONS_REQUIRED_SINCE,
} from "@/lib/services/games/league-of-legends/match-history.service";
import { alertGameAnomalies, recordRankSnapshot } from "@/lib/services/games/league-of-legends/tracker-events";
import { purgeOldTrackerData } from "@/lib/services/games/league-of-legends/retention";

const T = (h: number) => new Date(Date.UTC(2026, 11, 1, h)); // after sessions became required
const ms = (d: Date) => d.getTime();

describe("who played a game", () => {
  const assignment = { id: "a1", status: "IN_PROGRESS", startedAt: T(0), endedAt: null };
  const now = T(20);
  const pausedEvents = [
    { type: "ORDER_PAUSED", createdAt: T(10) },
    { type: "ORDER_RESUMED", createdAt: T(12) },
  ];

  it("session games are the booster's; pauses and the rest are not", () => {
    const sessions = [{ startedAt: T(1), endedAt: T(5) }, { startedAt: T(9), endedAt: null }];
    const booster = boosterWindows([assignment], sessions, pausedEvents, now);
    const pauses = pauseWindows(pausedEvents, now);
    // The open session from 9:00 is cut by the 10:00-12:00 pause.
    expect(booster).toEqual([
      { start: ms(T(1)), end: ms(T(5)) },
      { start: ms(T(9)), end: ms(T(10)) },
      { start: ms(T(12)), end: ms(T(20)) },
    ]);
    expect(classifyGame(ms(T(2)), ms(T(2)) + 1_800_000, booster, pauses)).toBe("BOOSTER");
    expect(classifyGame(ms(T(6)), ms(T(6)) + 1_800_000, booster, pauses)).toBe("CUSTOMER");
    expect(classifyGame(ms(T(10)) + 600_000, ms(T(11)), booster, pauses)).toBe("PAUSED");
    // Games are looked for during pauses too (the whole time the booster holds the order).
    expect(scanWindows([assignment], now)).toEqual([{ start: ms(T(0)), end: ms(T(20)) }]);
  });

  it("orders started before sessions existed keep the earlier rule", () => {
    const old = { ...assignment, startedAt: new Date(ms(SESSIONS_REQUIRED_SINCE) - 3_600_000) };
    const booster = boosterWindows([old], [], [], new Date(ms(SESSIONS_REQUIRED_SINCE) + 3_600_000));
    expect(booster).toHaveLength(1);
    expect(classifyGame(ms(SESSIONS_REQUIRED_SINCE) - 600_000, ms(SESSIONS_REQUIRED_SINCE), booster, [])).toBe("BOOSTER");
  });

  it("attributeMatch reports who played", () => {
    const match = {
      metadata: { matchId: "EUW1_1" },
      info: {
        queueId: 420,
        gameStartTimestamp: ms(T(6)),
        gameEndTimestamp: ms(T(6)) + 1_800_000,
        gameDuration: 1800,
        participants: [{ puuid: "p1", win: true, championId: 1, championName: "Annie", kills: 1, deaths: 1, assists: 1 }],
      },
    } as any;
    const windows = [{ start: ms(T(0)), end: ms(T(20)) }];
    expect(attributeMatch({ match, puuid: "p1", windows, queueIds: [420], booster: [], pauses: [] })).toEqual({ attributed: true, playedBy: "CUSTOMER" });
    expect(attributeMatch({ match, puuid: "p1", windows, queueIds: [420] })).toEqual({ attributed: true, playedBy: "BOOSTER" });
  });
});

describe("Postgres: snapshots, alerts, retention", () => {
  let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
  let admin: { id: string };
  let customer: { id: string };

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.APP_URL = "https://staging.legendsboost.test";
    prisma = await getTestPrisma();
    h.offers.push(rankOffer);
    h.checkouts.push(rankCheckout);
    admin = await seedUser("ADMIN");
    customer = await seedUser("CUSTOMER");
    await configurePrice(admin.id, 2500, 2500);
  }, 60_000);
  afterAll(closeTestDb);
  beforeEach(() => {
    h.stripe = createFakeStripe();
  });

  async function match(orderId: string, matchId: string, start: Date, playedBy = "BOOSTER") {
    await prisma.orderMatch.create({
      data: {
        orderId, matchId, queueId: 420, championId: 1, championName: "Annie", win: true, kills: 1, deaths: 1, assists: 1, cs: 100,
        durationSec: 1800, gameStartAt: start, gameEndAt: new Date(ms(start) + 1_800_000), playedBy,
      },
    });
    return { matchId, queueId: 420, gameStartAt: start, playedBy: playedBy as any };
  }

  it("one new game between two snapshots gets the LP change; two games do not", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    expect(await recordRankSnapshot(orderId, "RANKED_SOLO_5x5", { tier: "GOLD", division: "II", lp: 40 }, T(1), [])).toBeNull();
    const g1 = await match(orderId, "EUW1_10", T(2));
    expect(await recordRankSnapshot(orderId, "RANKED_SOLO_5x5", { tier: "GOLD", division: "II", lp: 61 }, T(3), [g1])).toBe(21);
    expect((await prisma.orderMatch.findFirstOrThrow({ where: { orderId, matchId: "EUW1_10" } })).lpDelta).toBe(21);

    // Promotion: Gold II 90 -> Gold I 10 = +20.
    await recordRankSnapshot(orderId, "RANKED_SOLO_5x5", { tier: "GOLD", division: "II", lp: 90 }, T(4), []);
    const g2 = await match(orderId, "EUW1_11", T(5));
    expect(await recordRankSnapshot(orderId, "RANKED_SOLO_5x5", { tier: "GOLD", division: "I", lp: 10 }, T(6), [g2])).toBe(20);

    const g3 = await match(orderId, "EUW1_12", T(7));
    const g4 = await match(orderId, "EUW1_13", T(8));
    expect(await recordRankSnapshot(orderId, "RANKED_SOLO_5x5", { tier: "GOLD", division: "I", lp: 50 }, T(9), [g3, g4])).toBeNull();
    expect((await prisma.orderMatch.findFirstOrThrow({ where: { orderId, matchId: "EUW1_12" } })).lpDelta).toBeNull();

    // Same rank and no new game: no new snapshot.
    const before = await prisma.orderRankSnapshot.count({ where: { orderId } });
    await recordRankSnapshot(orderId, "RANKED_SOLO_5x5", { tier: "GOLD", division: "I", lp: 50 }, T(10), []);
    expect(await prisma.orderRankSnapshot.count({ where: { orderId } })).toBe(before);
  });

  it("games outside sessions alert admins once, with an order event", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const games = [await match(orderId, "EUW1_20", T(2), "CUSTOMER"), await match(orderId, "EUW1_21", T(3), "PAUSED"), await match(orderId, "EUW1_22", T(4))];
    expect(await alertGameAnomalies(orderId, games)).toBe(2);
    await alertGameAnomalies(orderId, games);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "GAME_ANOMALY", orderId } })).toBe(2);
    const types = (await prisma.orderEvent.findMany({ where: { orderId, type: { in: ["GAME_DURING_PAUSE", "GAME_OUTSIDE_SESSION"] } } })).map((e) => e.type).sort();
    expect(types).toEqual(["GAME_DURING_PAUSE", "GAME_OUTSIDE_SESSION"]);
  });

  it("match and rank history are deleted 15 days after the order ends, never earlier", async () => {
    const now = new Date();
    const old = await createPaidOrder(customer.id);
    const recent = await createPaidOrder(customer.id);
    const live = await createPaidOrder(customer.id);
    for (const [o, days] of [[old.orderId, 20], [recent.orderId, 5]] as const) {
      await prisma.order.update({ where: { id: o }, data: { status: "COMPLETED", completedAt: new Date(ms(now) - days * 86_400_000) } });
    }
    for (const o of [old.orderId, recent.orderId, live.orderId]) {
      await match(o, `EUW1_${o.slice(-6)}`, T(2));
      await recordRankSnapshot(o, "RANKED_SOLO_5x5", { tier: "GOLD", division: "I", lp: 5 }, T(1), []);
    }
    const r = await purgeOldTrackerData(now);
    expect(r.days).toBe(15);
    expect(await prisma.orderMatch.count({ where: { orderId: old.orderId } })).toBe(0);
    expect(await prisma.orderRankSnapshot.count({ where: { orderId: old.orderId } })).toBe(0);
    expect(await prisma.orderMatch.count({ where: { orderId: recent.orderId } })).toBe(1);
    expect(await prisma.orderMatch.count({ where: { orderId: live.orderId } })).toBe(1);
    // The order itself stays.
    expect(await prisma.order.count({ where: { id: old.orderId } })).toBe(1);
  });
});
