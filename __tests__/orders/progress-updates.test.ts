// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Booster progress updates (decision 2026-11-17: replaces Riot tracking on
 * the order page) against an in-memory PostgreSQL (all migrations).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser, getRealtimeEligibleUser: h.getSessionUser }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn(), broadcastEvent: vi.fn() }));
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
import { claimAndStart, configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser, setConfig } from "../support/payment-fixtures";
import {
  allowedRankOptions,
  orderRankRange,
  computeReportedProgress,
  postProgressUpdate,
  runProgressReminders,
  selfCheckLink,
  stepIndex,
} from "@/lib/orders/progress-updates.service";
import { dispatchOutbox } from "@/lib/payments/outbox";
import { POST as progressRoute } from "@/app/api/orders/[orderId]/progress/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://app.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  const admin = await seedUser("ADMIN");
  await configurePrice(admin.id, 2500, 2500);
  await setConfig("claim_now_discount_bps", 0);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

/** Paid Gold IV -> Gold I order, claimed and started. */
async function working() {
  const customer = await seedUser("CUSTOMER");
  const booster = await seedUser("BOOSTER");
  const { orderId } = await createPaidOrder(customer.id);
  await claimAndStart(orderId, booster.id);
  return { customer, booster, orderId };
}

describe("rank ladder and progress", () => {
  const S = "lol-ranked";
  it("counts each tier x division as one step", () => {
    expect(stepIndex(S, { tierId: "iron", divisionId: "iv" })).toBe(0);
    expect(stepIndex(S, { tierId: "iron", divisionId: "i" })).toBe(3);
    expect(stepIndex(S, { tierId: "bronze", divisionId: "iv" })).toBe(4);
    expect(stepIndex(S, { tierId: "gold", divisionId: "x" })).toBeNull();
  });

  it("computes % from the reported rank, with LP as a fraction of a division", () => {
    const start = { tierId: "gold", divisionId: "iv" };
    const target = { tierId: "gold", divisionId: "i" }; // 3 steps
    expect(computeReportedProgress(S, start, null, target)).toMatchObject({ status: "waiting", percent: null });
    expect(computeReportedProgress(S, start, { tierId: "gold", divisionId: "iii", lp: null }, target)).toMatchObject({ status: "in_progress", percent: 33, stepsDelta: 1 });
    expect(computeReportedProgress(S, start, { tierId: "gold", divisionId: "iii", lp: 50 }, target).percent).toBe(50);
    expect(computeReportedProgress(S, start, { tierId: "gold", divisionId: "i", lp: 0 }, target)).toMatchObject({ status: "complete", percent: 100 });
    expect(computeReportedProgress(S, start, { tierId: "silver", divisionId: "i", lp: 10 }, target)).toMatchObject({ percent: 0, stepsDelta: -1 });
    expect(computeReportedProgress(S, target, null, start).status).toBe("invalid");
  });
});

describe("allowed ranks (bought range only)", () => {
  const S = "lol-ranked";
  it("Bronze I -> Gold I: only Bronze I, Silver IV-I and Gold IV-I", () => {
    const opts = allowedRankOptions(S, { currentRank: { tierId: "bronze", divisionId: "i" }, targetRank: { tierId: "gold", divisionId: "i" } });
    expect(opts.map((t) => `${t.tierId}:${t.divisions.map((d) => d.id).join(",")}`)).toEqual([
      "bronze:i",
      "silver:iv,iii,ii,i",
      "gold:iv,iii,ii,i",
    ]);
  });

  it("no range (Win Boost, placements…) -> nothing to pick", () => {
    expect(allowedRankOptions(S, {})).toEqual([]);
    expect(orderRankRange(S, { currentRank: { tierId: "gold", divisionId: "i" }, targetRank: { tierId: "gold", divisionId: "iv" } })).toBeNull();
  });

  it("the server refuses ranks below the start or above the target", async () => {
    // Fixture order: Gold IV -> Gold I.
    const w = await working();
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "silver", divisionId: "i" })).rejects.toThrow(/between Gold IV and Gold I/);
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "platinum", divisionId: "iv" })).rejects.toThrow(/between Gold IV and Gold I/);
    expect((await postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold", divisionId: "iv" })).label).toBe("Gold IV");
  });
});

describe("self-check link", () => {
  it("builds OP.GG and tracker.gg links from the Riot ID", () => {
    expect(selfCheckLink("league-of-legends", { gameName: "Faker Fan", tagLine: "EUW", platform: "EUW1" })?.url).toBe("https://op.gg/lol/summoners/euw/Faker%20Fan-EUW");
    expect(selfCheckLink("teamfight-tactics", { gameName: "A", tagLine: "#NA1", platform: "NA1" })?.url).toBe("https://op.gg/tft/summoners/na/A-NA1");
    expect(selfCheckLink("valorant", { gameName: "Jett", tagLine: "001", platform: null })?.url).toBe("https://tracker.gg/valorant/profile/riot/Jett%23001/overview");
    expect(selfCheckLink("league-of-legends", { gameName: "A", tagLine: "B", platform: null })).toBeNull();
    expect(selfCheckLink("league-of-legends", null)).toBeNull();
  });
});

describe("posting updates", () => {
  it("only the working booster, with a valid rank of the order's system; the customer is notified", async () => {
    const w = await working();
    const other = await seedUser("BOOSTER");
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: other.id, tierId: "gold", divisionId: "iii" })).rejects.toMatchObject({ status: 404 });
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "radiant" })).rejects.toThrow(/Choose a rank/);
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold" })).rejects.toThrow(/division/);
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold", divisionId: "iii", lp: -1 })).rejects.toThrow(/LP/);

    const before = (await prisma.order.findUniqueOrThrow({ where: { id: w.orderId } })).updatedAt;
    const r = await postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold", divisionId: "iii", lp: 42 });
    expect(r.label).toBe("Gold III 42 LP");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: w.orderId } })).updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    await dispatchOutbox({ limit: 50 });
    const n = await prisma.notification.findFirst({ where: { userId: w.customer.id, type: "ORDER_PROGRESS_UPDATED", orderId: w.orderId } });
    expect(n?.message).toContain("now Gold III 42 LP");

    // Double click protection.
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold", divisionId: "ii" })).rejects.toMatchObject({ status: 429 });
  });

  it("route: boosters only", async () => {
    const w = await working();
    const post = (userId: string, role: string, body: unknown) => {
      h.getSessionUser.mockResolvedValue({ id: userId, role });
      return progressRoute(
        new Request("http://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        { params: Promise.resolve({ orderId: w.orderId }) }
      );
    };
    expect((await post(w.customer.id, "CUSTOMER", { tierId: "gold", divisionId: "iii" })).status).toBe(403);
    expect((await post(w.booster.id, "BOOSTER", { tierId: "" })).status).toBe(400);
    expect((await post(w.booster.id, "BOOSTER", { tierId: "gold", divisionId: "ii", lp: 10 })).status).toBe(200);
  });
});

describe("24 h reminder", () => {
  it("reminds the booster once per 24 h without an update", async () => {
    const w = await working();
    const later = new Date(Date.now() + 25 * 3_600_000);
    await runProgressReminders(later);
    await runProgressReminders(later); // same period: no second reminder
    expect(await prisma.notification.count({ where: { userId: w.booster.id, type: "PROGRESS_UPDATE_DUE", orderId: w.orderId } })).toBe(1);

    // An update resets the clock.
    await postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold", divisionId: "iii" });
    await runProgressReminders(new Date(Date.now() + 2 * 3_600_000));
    expect(await prisma.notification.count({ where: { userId: w.booster.id, type: "PROGRESS_UPDATE_DUE", orderId: w.orderId } })).toBe(1);
  });
});

describe("Net Win / Placement Boost: games done (client PDFs 2026-11-24)", () => {
  /** A working order turned into a League Net Win (or Placement) Boost for 5 games. */
  async function workingGames(serviceSlug: "win-boost" | "placement-boost") {
    const { gameServices } = await vi.importActual<typeof import("@/lib/catalog/game-services")>("@/lib/catalog/game-services");
    const offer = gameServices.find((o) => o.gameSlug === "league-of-legends" && o.serviceSlug === serviceSlug)!;
    if (!h.offers.includes(offer)) h.offers.push(offer);
    const w = await working();
    const key = serviceSlug === "win-boost" ? "wins" : "placementsRemaining";
    await prisma.order.update({
      where: { id: w.orderId },
      data: { serviceSlug, configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, [key]: 5 } },
    });
    return w;
  }
  const lastUpdate = (orderId: string) => prisma.orderProgressUpdate.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: "desc" } });
  const rewind = (orderId: string) =>
    prisma.orderProgressUpdate.updateMany({ where: { orderId }, data: { createdAt: new Date(Date.now() - 60_000) } });

  it("net wins: 0..5 only, label 1/5 then 2/5, the starting rank is kept on the row", async () => {
    const w = await workingGames("win-boost");
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, tierId: "gold", divisionId: "iii" })).rejects.toThrow(/net wins done/);
    await expect(postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, gamesDone: 6 })).rejects.toThrow(/from 0 to 5/);
    expect((await postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, gamesDone: 1 })).label).toBe("1/5 net wins");
    expect(await lastUpdate(w.orderId)).toMatchObject({ gamesDone: 1, tierId: "gold", divisionId: "iv", lp: null });
    await rewind(w.orderId);
    expect((await postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, gamesDone: 2 })).label).toBe("2/5 net wins");
  });

  it("placements: the order page shows 0/5, then the same count for the customer and the booster", async () => {
    const { getOrderWorkspace } = await import("@/lib/orders/workspace-data");
    const w = await workingGames("placement-boost");
    const asCustomer = () => getOrderWorkspace(w.orderId, { id: w.customer.id, role: "CUSTOMER" } as any);
    const asBooster = () => getOrderWorkspace(w.orderId, { id: w.booster.id, role: "BOOSTER" } as any);
    expect((await asCustomer())!.progress).toMatchObject({ kind: "games", status: "waiting", games: { done: 0, total: 5, unit: "placement games" } });
    const b0 = (await asBooster())!;
    expect(b0.updates).toMatchObject({ canPost: true, games: { kind: "placements", total: 5 } });
    await postProgressUpdate({ orderId: w.orderId, boosterId: w.booster.id, gamesDone: 1 });
    expect((await asCustomer())!.progress).toMatchObject({ status: "in_progress", percent: 20, games: { done: 1, total: 5 } });
    expect((await asBooster())!.progress.games).toMatchObject({ done: 1, total: 5 });
    expect((await asCustomer())!.updates.list[0]).toMatchObject({ label: "1/5 placement games", gamesDone: 1 });
  });

  it("route: the booster posts { gamesDone }", async () => {
    const w = await workingGames("placement-boost");
    h.getSessionUser.mockResolvedValue({ id: w.booster.id, role: "BOOSTER" });
    const res = await progressRoute(
      new Request("http://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamesDone: 3 }) }),
      { params: Promise.resolve({ orderId: w.orderId }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).update.label).toBe("3/5 placement games");
  });
});
