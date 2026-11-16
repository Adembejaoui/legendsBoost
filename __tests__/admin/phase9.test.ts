// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 9 against an in-memory PostgreSQL (all migrations): account deletion
 * (blockers, admin decision, anonymisation, sign-in refused), the settings
 * API, admin read models (users, booster directory, live board), analytics
 * and rate limits on sensitive actions.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), offers: [] as any[], checkouts: [] as any[], stripe: null as any }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
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
import { claimOrder, completeAssignment } from "@/lib/assignments/service";
import { decideAccountDeletion, deletionBlockers, requestAccountDeletion } from "@/lib/account/deletion";
import { boosterDirectory, listUsers, liveOrdersBoard } from "@/lib/admin/directory";
import { adminAnalytics } from "@/lib/admin/analytics";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { GET as configGet, PUT as configPut } from "@/app/api/admin/config/route";
import { POST as bidRoute } from "@/app/api/booster/orders/[orderId]/bid/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string; role: string };
let customer: { id: string; role: string };

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  customer = await seedUser("CUSTOMER");
  await configurePrice(admin.id, 2500, 2500);
  await setConfig("claim_now_discount_bps", 0);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

const put = (body: unknown) => new Request("http://t/api/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("account deletion", () => {
  it("blocked while something is running; then an admin approves and the account is anonymised", async () => {
    const c = await seedUser("CUSTOMER");
    const { orderId } = await createPaidOrder(c.id);
    expect(await deletionBlockers(c.id)).toEqual(["You have an order that is not finished yet."]);
    await expect(requestAccountDeletion(c.id, "bye")).rejects.toMatchObject({ status: 409 });

    // Finish the order: nothing blocks any more.
    const b = await seedUser("BOOSTER");
    const { assignment } = await claimAndStart(orderId, b.id);
    await completeAssignment(assignment.id, b.id, "BOOSTER");
    await prisma.orderRiotAccount.create({ data: { orderId, gameName: "Private", tagLine: "EUW", platform: "EUW1", puuid: "secret-puuid" } });

    const req = await requestAccountDeletion(c.id, "No longer playing");
    await expect(requestAccountDeletion(c.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "ACCOUNT_DELETION_REQUESTED" } })).toBeGreaterThanOrEqual(1);

    await expect(decideAccountDeletion(c.id, req.id, true)).rejects.toMatchObject({ status: 403 });
    await expect(decideAccountDeletion(admin.id, req.id, false)).rejects.toMatchObject({ status: 400 }); // reject needs a note
    await decideAccountDeletion(admin.id, req.id, true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
    expect(user).toMatchObject({ name: "Deleted user", email: `deleted-${c.id}@deleted.invalid`, passwordHash: null, image: null });
    expect(user.deletedAt).toBeInstanceOf(Date);
    // Sign-in lookups skip deleted users.
    expect(await prisma.user.findUnique({ where: { id: c.id, deletedAt: null } })).toBeNull();
    const ra = await prisma.orderRiotAccount.findUniqueOrThrow({ where: { orderId } });
    expect(ra).toMatchObject({ gameName: "deleted", puuid: null });
    // Money records are kept.
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_DELETED", entityId: c.id } })).toBe(1);
  });

  it("a booster with unpaid earnings must cash out first; admins cannot use the form", async () => {
    const b = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    const { assignment } = await claimAndStart(orderId, b.id);
    await completeAssignment(assignment.id, b.id, "BOOSTER");
    await expect(requestAccountDeletion(b.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/payout/) });
    await expect(requestAccountDeletion(admin.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("settings API", () => {
  it("admin only; values are validated; null resets", async () => {
    h.getSessionUser.mockResolvedValue(customer);
    expect((await configPut(put({ key: "bid_window_sec", value: 120 }))).status).toBe(403);
    h.getSessionUser.mockResolvedValue(admin);
    expect((await configPut(put({ key: "bid_window_sec", value: 5 }))).status).toBe(400); // below the minimum
    expect((await configPut(put({ key: "nope", value: 1 }))).status).toBe(400);
    expect((await configPut(put({ key: "bid_window_sec", value: 120 }))).status).toBe(200);
    const list = (await (await configGet()).json()).config as { key: string; value: unknown; overridden: boolean }[];
    expect(list.find((r) => r.key === "bid_window_sec")).toMatchObject({ value: 120, overridden: true });
    expect((await configPut(put({ key: "bid_window_sec", value: null }))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "CONFIG_CHANGED", entityId: "bid_window_sec" } })).toBe(2);
  });
});

describe("admin read models and analytics", () => {
  it("users search, booster directory, live board and the overview numbers", async () => {
    const b = await seedUser("BOOSTER");
    const done = await createPaidOrder(customer.id);
    const { assignment } = await claimAndStart(done.orderId, b.id);
    await completeAssignment(assignment.id, b.id, "BOOSTER");
    await prisma.orderReview.create({ data: { orderId: done.orderId, customerId: customer.id, boosterId: b.id, rating: 4 } });

    const waiting = await createPaidOrder(customer.id);
    await prisma.order.update({ where: { id: waiting.orderId }, data: { paymentVerifiedAt: new Date(Date.now() - 3 * 3_600_000) } });
    const taken = await createPaidOrder(customer.id);
    const b2 = await seedUser("BOOSTER");
    await claimOrder(taken.orderId, b2.id);

    expect((await listUsers({ q: b.id })).map((u) => u.id)).toEqual([b.id]);
    const dir = (await boosterDirectory()).find((x) => x.id === b.id)!;
    expect(dir).toMatchObject({ completed: 1, active: 0, reviews: 1, rating: 4 });

    const board = await liveOrdersBoard();
    expect(board.find((o) => o.id === waiting.orderId)).toMatchObject({ status: "PENDING", tone: "alert" });
    expect(board.find((o) => o.id === taken.orderId)).toMatchObject({ status: "CLAIMED", tone: "ok", note: "not started" });
    expect(board.some((o) => o.id === done.orderId)).toBe(false); // completed orders are not on the board

    const a = await adminAnalytics(30);
    expect(a.paidOrders).toBeGreaterThanOrEqual(3);
    expect(a.revenue.EUR).toBeGreaterThanOrEqual(30_000);
    expect(a.completedOrders).toBeGreaterThanOrEqual(1);
    expect(a.avgMinutesToClaim).not.toBeNull();
    expect(a.topBoosters.some((t) => t.id === b.id)).toBe(true);
  });
});

describe("rate limits", () => {
  it("too many bids in a minute are refused with 429", async () => {
    const b = await seedUser("BOOSTER");
    for (let i = 0; i < LIMITS.bidPerUser.max; i++) await sharedRateLimit("bid", b.id, LIMITS.bidPerUser);
    h.getSessionUser.mockResolvedValue({ id: b.id, role: "BOOSTER" });
    const res = await bidRoute(
      new Request("http://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 1000 }) }) as unknown as NextRequest,
      { params: Promise.resolve({ orderId: "any" }) }
    );
    expect(res.status).toBe(429);
  });
});
