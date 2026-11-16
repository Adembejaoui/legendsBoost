// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 7 against an in-memory PostgreSQL (all migrations): payout methods
 * (validation, encryption, 48 h lock after a change, snapshot on the payout,
 * audited admin reveal), the identity check before payouts, and the
 * suggested split by progress.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

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
import { completeAssignment } from "@/lib/assignments/service";
import { approveEarning } from "@/lib/finance/earnings";
import { requestPayout } from "@/lib/finance/payouts";
import { getPayoutMethodStatus, isValidIban, methodHint, payoutMethodSchema, revealPayoutMethod, setPayoutMethod } from "@/lib/finance/payout-methods";
import { progressByAssignment, suggestSplit } from "@/lib/finance/split-suggestion";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string };

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://staging.legendsboost.test";
  process.env.ACCOUNT_CREDENTIALS_KEY = randomBytes(32).toString("base64");
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

/** A booster with one AVAILABLE earning. */
async function boosterReadyToCashOut() {
  const b = await seedUser("BOOSTER");
  const { orderId } = await createPaidOrder(customer.id);
  const { assignment } = await claimAndStart(orderId, b.id);
  await completeAssignment(assignment.id, b.id, "BOOSTER");
  const e = await prisma.boosterEarning.findFirstOrThrow({ where: { boosterId: b.id, orderId } });
  await approveEarning(admin.id, e.id);
  return b;
}

describe("payout method validation", () => {
  it("checks IBANs, crypto addresses and PayPal emails", () => {
    expect(isValidIban("FR7630006000011234567890189")).toBe(true);
    expect(isValidIban("FR7630006000011234567890188")).toBe(false);
    expect(payoutMethodSchema.safeParse({ type: "IBAN", holder: "Jane Doe", iban: "fr76 3000 6000 0112 3456 7890 189" }).success).toBe(true);
    expect(payoutMethodSchema.safeParse({ type: "CRYPTO", network: "USDT_TRC20", address: "0x52908400098527886E0F7030069857D2E4169EE7" }).success).toBe(false);
    expect(payoutMethodSchema.safeParse({ type: "CRYPTO", network: "USDT_ERC20", address: "0x52908400098527886E0F7030069857D2E4169EE7" }).success).toBe(true);
    expect(payoutMethodSchema.safeParse({ type: "PAYPAL", email: "not-an-email" }).success).toBe(false);
  });

  it("hints never show the full details", () => {
    expect(methodHint({ type: "PAYPAL", email: "johnny@example.com" })).toBe("PayPal jo•••@example.com");
    expect(methodHint({ type: "IBAN", holder: "J", iban: "FR7630006000011234567890189" })).toBe("IBAN FR76 •••• 0189");
  });
});

describe("payout methods and payout gates", () => {
  it("stored encrypted; a change locks payouts for 48 h and alerts the booster", async () => {
    const b = await boosterReadyToCashOut();
    await prisma.boosterPayoutMethod.delete({ where: { boosterId: b.id } });
    await expect(requestPayout(b.id, "EUR")).rejects.toMatchObject({ status: 409 }); // no method

    await setPayoutMethod(b.id, { type: "PAYPAL", email: "first@example.com" });
    const row = await prisma.boosterPayoutMethod.findUniqueOrThrow({ where: { boosterId: b.id } });
    expect(row.ciphertext).not.toContain("first@example.com");
    expect((await getPayoutMethodStatus(b.id))?.lockedUntil).toBeNull(); // first method: no lock

    await setPayoutMethod(b.id, { type: "IBAN", holder: "Jane Doe", iban: "FR7630006000011234567890189" });
    const status = await getPayoutMethodStatus(b.id);
    expect(status?.lockedUntil).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: b.id, type: "PAYOUT_METHOD_CHANGED" } })).toBe(1);
    await expect(requestPayout(b.id, "EUR")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/changed recently/) });

    // 49 hours later.
    await prisma.boosterPayoutMethod.update({ where: { boosterId: b.id }, data: { setAt: new Date(Date.now() - 49 * 3_600_000) } });
    const payout = await requestPayout(b.id, "EUR");
    expect(payout).toMatchObject({ methodType: "IBAN", methodHint: "IBAN FR76 •••• 0189" });

    // A later change does not redirect this payout.
    await setPayoutMethod(b.id, { type: "PAYPAL", email: "attacker@example.com" });
    await expect(revealPayoutMethod(b.id, payout.id)).rejects.toMatchObject({ status: 403 });
    const details = await revealPayoutMethod(admin.id, payout.id);
    expect(details).toMatchObject({ type: "IBAN", iban: "FR7630006000011234567890189", holder: "Jane Doe" });
    expect((await prisma.boosterPayout.findUniqueOrThrow({ where: { id: payout.id } })).methodRevealCount).toBe(1);
    expect(await prisma.financialAuditLog.count({ where: { action: "PAYOUT_METHOD_REVEALED", entityId: payout.id } })).toBe(1);
  });

  it("an unverified identity cannot request a payout", async () => {
    const b = await boosterReadyToCashOut();
    await prisma.boosterProfile.update({ where: { userId: b.id }, data: { kycStatus: "PENDING" } });
    await expect(requestPayout(b.id, "EUR")).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/identity/) });
  });
});

describe("suggested split by progress", () => {
  it("splits by points, floor, remainder to the biggest contributor, nothing to split by = null", () => {
    expect(suggestSplit(5500, [{ id: "a", points: 100 }, { id: "b", points: 300 }])).toEqual([
      { id: "a", amount: 1375 },
      { id: "b", amount: 4125 },
    ]);
    expect(suggestSplit(1000, [{ id: "a", points: 1 }, { id: "b", points: 2 }])).toEqual([
      { id: "a", amount: 333 },
      { id: "b", amount: 667 },
    ]);
    expect(suggestSplit(5500, [{ id: "a", points: -50 }, { id: "b", points: 0 }])).toBeNull();
  });

  it("rank progress made while each booster held the order", async () => {
    const { orderId } = await createPaidOrder(customer.id); // Gold IV -> Gold I
    const t = (h: number) => new Date(Date.UTC(2026, 10, 20, h));
    await prisma.orderRiotAccount.create({ data: { orderId, gameName: "T", tagLine: "EUW", platform: "EUW1", baselineTier: "GOLD", baselineDivision: "IV", baselineLp: 0, baselineAt: t(0) } });
    for (const [h, div, lp] of [[3, "IV", 80], [6, "III", 50], [12, "I", 0]] as const) {
      await prisma.orderRankSnapshot.create({ data: { orderId, queue: "RANKED_SOLO_5x5", tier: "GOLD", division: div, lp, takenAt: t(h) } });
    }
    const progress = await progressByAssignment(orderId, [
      { id: "first", startedAt: t(1), endedAt: t(6) }, // Gold IV 0 -> Gold III 50 = 150
      { id: "second", startedAt: t(7), endedAt: t(13) }, // Gold III 50 -> Gold I 0 = 150
    ]);
    expect(progress).toEqual({ basis: "rank", entries: [{ id: "first", points: 150 }, { id: "second", points: 150 }] });
    expect(suggestSplit(5500, progress!.entries)).toEqual([{ id: "first", amount: 2750 }, { id: "second", amount: 2750 }]);
  });
});
