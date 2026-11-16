// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 2 against an in-memory PostgreSQL (all migrations, including the
 * booster lifecycle one): status transitions and who may make them, rank
 * ceilings (default from peak rank, admin sets, booster may only lower),
 * trial orders used up on claim, and re-applying after "needs info".
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
  stripe: null as any,
}));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(async () => {}), createNotification: vi.fn(async () => {}) }));
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

import { closeTestDb, getTestPrisma, uid } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser } from "../support/payment-fixtures";
import { BOOSTER_TRANSITIONS, canTransitionBooster, transitionBooster } from "@/lib/boosters/transitions";
import { canClaimNewOrders, hasBoosterAccess } from "@/lib/boosters/status";
import { defaultPermissionsFromApplication, lowerOwnCeiling } from "@/lib/boosters/permissions";
import { adminChangeBoosterStatus, adminSetPermission } from "@/lib/boosters/admin.service";
import { claimOrder } from "@/lib/assignments/service";
import { POST as applyRoute } from "@/app/api/booster/apply/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string; role: string };

const appData = (peak = { tierId: "diamond", divisionId: "ii" }) => ({
  games: [{ gameSlug: "league-of-legends", region: "euw1", peakRank: peak, currentRank: peak, proofUrl: "https://op.gg/x" }],
});

async function applicant(status: string, applicationData: unknown = appData()) {
  const id = uid("applicant");
  await prisma.user.create({
    data: { id, email: `${id}@t.test`, name: id, role: "CUSTOMER", boosterProfile: { create: { verificationStatus: status as any, applicationData: applicationData as any } } },
  });
  const profile = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: id } });
  return { id, profileId: profile.id };
}

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

describe("status helpers", () => {
  it("only active, trial and on-break boosters have booster access", () => {
    for (const s of ["APPROVED", "TRIAL", "ON_BREAK"]) expect(hasBoosterAccess(s)).toBe(true);
    for (const s of ["PENDING", "UNDER_REVIEW", "NEEDS_INFO", "REJECTED", "SUSPENDED", "TERMINATED", null]) expect(hasBoosterAccess(s)).toBe(false);
  });

  it("new orders: active boosters, or trial boosters with orders left", () => {
    expect(canClaimNewOrders("APPROVED", null)).toBe(true);
    expect(canClaimNewOrders("TRIAL", 1)).toBe(true);
    expect(canClaimNewOrders("TRIAL", 0)).toBe(false);
    expect(canClaimNewOrders("ON_BREAK", null)).toBe(false);
    expect(canClaimNewOrders("SUSPENDED", null)).toBe(false);
  });
});

describe("transition table", () => {
  it("terminated is final, and the booster can only pause, resume or re-apply", () => {
    expect(BOOSTER_TRANSITIONS.TERMINATED).toEqual({});
    expect(canTransitionBooster("APPROVED", "ON_BREAK", "self")).toBe(true);
    expect(canTransitionBooster("ON_BREAK", "APPROVED", "self")).toBe(true);
    expect(canTransitionBooster("NEEDS_INFO", "PENDING", "self")).toBe(true);
    expect(canTransitionBooster("PENDING", "APPROVED", "self")).toBe(false);
    expect(canTransitionBooster("SUSPENDED", "APPROVED", "self")).toBe(false);
    expect(canTransitionBooster("NEEDS_INFO", "PENDING", "admin")).toBe(false);
  });

  it("rejects illegal moves and stale expected statuses", async () => {
    const a = await applicant("PENDING");
    await expect(
      prisma.$transaction((tx) => transitionBooster(tx, { profileId: a.profileId, to: "SUSPENDED", actorId: admin.id, actor: "admin", note: "x" }))
    ).rejects.toMatchObject({ status: 403 });
    await expect(adminChangeBoosterStatus(admin.id, a.id, "TRIAL", null, "UNDER_REVIEW")).rejects.toMatchObject({ status: 409 });
  });

  it("an admin needs a note to request info, reject, suspend or terminate", async () => {
    const a = await applicant("PENDING");
    await expect(adminChangeBoosterStatus(admin.id, a.id, "NEEDS_INFO")).rejects.toMatchObject({ status: 400 });
    await adminChangeBoosterStatus(admin.id, a.id, "NEEDS_INFO", "Add a proof link for Valorant");
    const p = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: a.id } });
    expect(p.verificationStatus).toBe("NEEDS_INFO");
    expect(p.reviewNote).toBe("Add a proof link for Valorant");
  });

  it("approving to trial gives the booster role, 3 trial orders and default ceilings; history is kept", async () => {
    const a = await applicant("PENDING");
    await adminChangeBoosterStatus(admin.id, a.id, "TRIAL");
    const p = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: a.id }, include: { permissions: true, events: true, user: true } });
    expect(p.verificationStatus).toBe("TRIAL");
    expect(p.trialOrdersRemaining).toBe(3);
    expect(p.user.role).toBe("BOOSTER");
    expect(p.permissions).toHaveLength(1);
    expect(p.permissions[0]).toMatchObject({ gameSlug: "league-of-legends", maxTargetTierId: "diamond", maxTargetDivisionId: "ii" });
    expect(p.events.map((e) => e.type).sort()).toEqual(["CEILING_SET", "STATUS_CHANGED"]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "BOOSTER_STATUS_CHANGED", entityId: p.id } });
    expect(audit).not.toBeNull();
  });

  it("an admin cannot review their own application", async () => {
    const a = await applicant("PENDING");
    await prisma.user.update({ where: { id: a.id }, data: { role: "ADMIN" } });
    await expect(adminChangeBoosterStatus(a.id, a.id, "APPROVED")).rejects.toMatchObject({ status: 403 });
  });
});

describe("rank ceilings", () => {
  it("defaults come from the declared peak rank; unknown games and bad ranks are skipped", () => {
    const d = defaultPermissionsFromApplication({
      games: [
        { gameSlug: "league-of-legends", peakRank: { tierId: "gold", divisionId: "i" } },
        { gameSlug: "unknown-game", peakRank: { tierId: "gold", divisionId: "i" } },
        { gameSlug: "valorant", peakRank: { tierId: "nope", divisionId: null } },
      ],
    });
    expect(d.map((x) => x.gameSlug)).toEqual(["league-of-legends"]);
    expect(defaultPermissionsFromApplication(null)).toEqual([]);
  });

  it("a booster can lower their ceiling but never raise it; an admin can raise it", async () => {
    const a = await applicant("PENDING");
    await adminChangeBoosterStatus(admin.id, a.id, "APPROVED");

    await expect(
      prisma.$transaction((tx) => lowerOwnCeiling(tx, a.id, "league-of-legends", { tierId: "master", divisionId: null }))
    ).rejects.toMatchObject({ status: 403 });
    await prisma.$transaction((tx) => lowerOwnCeiling(tx, a.id, "league-of-legends", { tierId: "platinum", divisionId: "i" }));
    let perm = await prisma.boosterPermission.findFirstOrThrow({ where: { boosterProfile: { userId: a.id } } });
    expect(perm.maxTargetTierId).toBe("platinum");

    await adminSetPermission(admin.id, a.id, { gameSlug: "league-of-legends", maxTargetRank: { tierId: "master", divisionId: null }, regions: ["EUW1"], serviceSlugs: [] });
    perm = await prisma.boosterPermission.findFirstOrThrow({ where: { boosterProfile: { userId: a.id } } });
    expect(perm).toMatchObject({ maxTargetTierId: "master", regions: ["EUW1"] });

    await expect(
      adminSetPermission(admin.id, a.id, { gameSlug: "league-of-legends", maxTargetRank: { tierId: "master", divisionId: null }, regions: ["MARS1"], serviceSlugs: [] })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("trial orders", () => {
  it("each claim uses one trial order; with none left the booster cannot claim", async () => {
    const a = await applicant("PENDING");
    await adminChangeBoosterStatus(admin.id, a.id, "TRIAL");
    await prisma.boosterProfile.update({ where: { userId: a.id }, data: { trialOrdersRemaining: 1 } });

    const first = await createPaidOrder(customer.id);
    await claimOrder(first.orderId, a.id);
    const p = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: a.id } });
    expect(p.trialOrdersRemaining).toBe(0);

    const second = await createPaidOrder(customer.id);
    await expect(claimOrder(second.orderId, a.id)).rejects.toThrow();
    expect(await prisma.orderBoosterAssignment.count({ where: { orderId: second.orderId } })).toBe(0);
  });

  it("a booster on a break cannot claim new orders", async () => {
    const a = await applicant("PENDING");
    await adminChangeBoosterStatus(admin.id, a.id, "APPROVED");
    const profile = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: a.id } });
    await prisma.$transaction((tx) => transitionBooster(tx, { profileId: profile.id, to: "ON_BREAK", actorId: a.id, actor: "self" }));
    const o = await createPaidOrder(customer.id);
    await expect(claimOrder(o.orderId, a.id)).rejects.toThrow();
  });
});

describe("apply route", () => {
  const body = () => ({
    personal: { fullName: "Test Booster", country: "FR", discordUsername: "tester#1" },
    games: appData().games.map((g) => ({ ...g, mainRole: "mid", yearsExperience: 3 })),
    experience: { biography: "I have boosted accounts for several years on EUW.", portfolioLinks: [] },
    availability: { languages: ["en"], availableDays: ["mon"], availableTimeSlots: ["evening"], timezone: "Europe/Paris" },
    declaration: { codeOfConduct: true, informationAccurate: true },
  });
  const post = (b: unknown) => applyRoute(new Request("http://t/api/booster/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }) as any);

  it("a booster asked for more info can re-submit; a pending one cannot submit twice", async () => {
    const a = await applicant("NEEDS_INFO");
    h.getSessionUser.mockResolvedValue({ id: a.id, role: "CUSTOMER" });
    const res = await post(body());
    if (res.status !== 200 && res.status !== 201) throw new Error(`apply failed: ${res.status} ${JSON.stringify(await res.json())}`);
    const p = await prisma.boosterProfile.findUniqueOrThrow({ where: { userId: a.id } });
    expect(p.verificationStatus).toBe("PENDING");
    expect(p.rulesVersion).toBeTruthy();

    const again = await post(body());
    expect(again.status).toBe(409);
  });

  it("suspended and terminated boosters cannot apply", async () => {
    const a = await applicant("SUSPENDED");
    h.getSessionUser.mockResolvedValue({ id: a.id, role: "BOOSTER" });
    expect((await post(body())).status).toBe(403);
  });
});
