// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 8 against an in-memory PostgreSQL (all migrations): reviews (owner
 * only, completed only, once, filtered text, one reply, hidden ones count
 * nowhere), public booster profiles, and tips (Stripe Checkout, split like an
 * order, ledger, pending earning, idempotent webhook).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

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
import { createFakeStripe, stripeEvent, WEBHOOK_SECRET } from "../support/fake-stripe";
import { claimAndStart, configurePrice, createPaidOrder, deliver, ledgerFor, rankCheckout, rankOffer, seedUser, setConfig, sum } from "../support/payment-fixtures";
import { completeAssignment } from "@/lib/assignments/service";
import { createReview, ratingSummary, replyToReview, setReviewHidden } from "@/lib/reviews/service";
import { getPublicBooster, listPublicBoosters } from "@/lib/boosters/public-profile";
import { createTipCheckout, splitTip } from "@/lib/tips/service";
import { getOrderWorkspace } from "@/lib/orders/workspace-data";

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
  await setConfig("claim_now_discount_bps", 0);
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

/** A completed order of a booster with a public name. */
async function completedOrder(displayName?: string) {
  const b = await seedUser("BOOSTER");
  if (displayName) await prisma.boosterProfile.update({ where: { userId: b.id }, data: { displayName } });
  const { orderId } = await createPaidOrder(customer.id);
  const { assignment } = await claimAndStart(orderId, b.id);
  await completeAssignment(assignment.id, b.id, "BOOSTER");
  return { booster: b, orderId };
}

describe("reviews", () => {
  it("only the customer, only when completed, only once; contact details hidden", async () => {
    const { orderId: open } = await createPaidOrder(customer.id);
    await expect(createReview(customer.id, open, { rating: 5 })).rejects.toMatchObject({ status: 409 });

    const { booster, orderId } = await completedOrder();
    const other = await seedUser("CUSTOMER");
    await expect(createReview(other.id, orderId, { rating: 5 })).rejects.toMatchObject({ status: 404 });
    await expect(createReview(customer.id, orderId, { rating: 6 })).rejects.toMatchObject({ status: 400 });
    await expect(createReview(customer.id, orderId, { rating: 4, tags: ["Not a tag"] })).rejects.toMatchObject({ status: 400 });

    const r = await createReview(customer.id, orderId, { rating: 5, tags: ["Fast delivery", "Fast delivery"], text: "Great, add me on discord: myname" });
    expect(r).toMatchObject({ boosterId: booster.id, rating: 5, tags: ["Fast delivery"] });
    expect(r.text).not.toContain("myname");
    await expect(createReview(customer.id, orderId, { rating: 1 })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.notification.count({ where: { userId: booster.id, type: "REVIEW_RECEIVED" } })).toBe(1);

    await expect(replyToReview(admin.id, r.id, "not mine")).rejects.toMatchObject({ status: 409 });
    await replyToReview(booster.id, r.id, "Thanks, glad it went well!");
    await expect(replyToReview(booster.id, r.id, "again")).rejects.toMatchObject({ status: 409 });
  });

  it("hidden reviews count nowhere; the summary averages visible ones", async () => {
    const one = await completedOrder("SummaryPro");
    const r1 = await createReview(customer.id, one.orderId, { rating: 5, tags: ["Very skilled"] });
    // Second order for the same booster.
    const { orderId } = await createPaidOrder(customer.id);
    const { assignment } = await claimAndStart(orderId, one.booster.id);
    await completeAssignment(assignment.id, one.booster.id, "BOOSTER");
    const r2 = await createReview(customer.id, orderId, { rating: 2 });

    expect(await ratingSummary(one.booster.id)).toMatchObject({ count: 2, average: 3.5, fiveStarPercent: 50 });
    await expect(setReviewHidden(customer.id, r2.id, true, "spam")).rejects.toMatchObject({ status: 403 });
    await expect(setReviewHidden(admin.id, r2.id, true)).rejects.toMatchObject({ status: 400 });
    await setReviewHidden(admin.id, r2.id, true, "Abusive language");
    expect(await ratingSummary(one.booster.id)).toMatchObject({ count: 1, average: 5, tags: [{ tag: "Very skilled", count: 1 }] });

    const profile = await getPublicBooster("summarypro");
    expect(profile?.reviews.map((x) => x.id)).toEqual([r1.id]);
    expect(profile).toMatchObject({ displayName: "SummaryPro", completedOrders: 2 });
  });

  it("public list: only active boosters with a public name", async () => {
    const shown = await completedOrder("ListedOne");
    await completedOrder(); // no public name
    const suspended = await completedOrder("Suspended1");
    await prisma.boosterProfile.update({ where: { userId: suspended.booster.id }, data: { verificationStatus: "SUSPENDED" } });
    const names = (await listPublicBoosters()).map((b) => b.displayName);
    expect(names).toContain("ListedOne");
    expect(names).not.toContain("Suspended1");
    expect(JSON.stringify(await listPublicBoosters())).not.toContain("@t.test"); // no emails
    void shown;
  });
});

describe("tips", () => {
  it("85 % to the booster, 15 % to the company (tip test 2026-11-22)", () => {
    expect(splitTip(2000)).toEqual({ boosterAmount: 1700, platformFeeAmount: 300 }); // 20 -> 17 + 3
    expect(splitTip(333)).toEqual({ boosterAmount: 283, platformFeeAmount: 50 }); // booster gets the floor
    expect(splitTip(1000, 5500)).toEqual({ boosterAmount: 550, platformFeeAmount: 450 });
  });

  it("while the order is Processing, to the booster holding it (client PDF 2026-11-22)", async () => {
    const b = await seedUser("BOOSTER");
    const { orderId } = await createPaidOrder(customer.id);
    await claimAndStart(orderId, b.id);
    const r = await createTipCheckout(customer.id, orderId, 500);
    expect(r.url).toBeTruthy();
    expect(await prisma.orderTip.findUniqueOrThrow({ where: { id: r.tipId } })).toMatchObject({ boosterId: b.id, amount: 500 });
  });

  it("only once a booster has the order (Processing or Completed), within limits", async () => {
    const { orderId: open } = await createPaidOrder(customer.id);
    await expect(createTipCheckout(customer.id, open, 500)).rejects.toMatchObject({ status: 409 });
    const { orderId } = await completedOrder();
    await expect(createTipCheckout(customer.id, orderId, 50)).rejects.toMatchObject({ status: 400 });
    await expect(createTipCheckout(customer.id, orderId, 60_000)).rejects.toMatchObject({ status: 400 });
    const other = await seedUser("CUSTOMER");
    await expect(createTipCheckout(other.id, orderId, 500)).rejects.toMatchObject({ status: 404 });
  });

  it("paid tip: ledger split, pending booster earning, booster notified; replay changes nothing", async () => {
    const { booster, orderId } = await completedOrder();
    const { url, tipId } = await createTipCheckout(customer.id, orderId, 1000);
    expect(url).toMatch(/^https:\/\//);
    const tip = await prisma.orderTip.findUniqueOrThrow({ where: { id: tipId } });
    const session = {
      id: tip.stripeSessionId,
      object: "checkout.session",
      payment_status: "paid",
      status: "complete",
      amount_total: 1000,
      currency: "eur",
      metadata: { kind: "tip", tipId, orderId, customerId: customer.id },
    };
    const event = stripeEvent("checkout.session.completed", session);
    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).status).toBe(200); // replay

    expect((await prisma.orderTip.findUniqueOrThrow({ where: { id: tipId } })).status).toBe("PAID");
    const ledger = (await ledgerFor(orderId)).filter((t) => t.type.startsWith("TIP_"));
    expect(sum(ledger, (t) => t.account === "CUSTOMER_PAYMENTS")).toBe(1000);
    expect(sum(ledger, (t) => t.account === "PLATFORM_REVENUE")).toBe(150);
    expect(sum(ledger, (t) => t.account === "BOOSTER_PAYABLE" && t.boosterId === booster.id)).toBe(850);
    const earning = await prisma.boosterEarning.findFirstOrThrow({ where: { boosterId: booster.id, allocationNote: "Tip from the customer" } });
    expect(earning).toMatchObject({ status: "PENDING", grossAmount: 850, boosterShareBps: 8500, platformFeeBps: 1500 });
    expect(await prisma.notification.count({ where: { userId: booster.id, type: "TIP_RECEIVED" } })).toBe(1);
    // The order payment itself is untouched.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("COMPLETED");
  });

  it("a session whose amount does not match the tip is ignored", async () => {
    const { orderId } = await completedOrder();
    const { tipId } = await createTipCheckout(customer.id, orderId, 500);
    const tip = await prisma.orderTip.findUniqueOrThrow({ where: { id: tipId } });
    await deliver(
      stripeEvent("checkout.session.completed", {
        id: tip.stripeSessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 1,
        currency: "eur",
        metadata: { kind: "tip", tipId, orderId, customerId: customer.id },
      })
    );
    expect((await prisma.orderTip.findUniqueOrThrow({ where: { id: tipId } })).status).toBe("PENDING");
  });
});

describe("account details after completion (client PDF 2026-11-22)", () => {
  it("the booster no longer gets the Riot ID or the OP.GG link once the order is Completed; the customer still does", async () => {
    const { booster, orderId } = await completedOrder();
    await prisma.orderRiotAccount.create({ data: { orderId, gameName: "Faker", tagLine: "KR1", platform: "kr" } });
    const asBooster = await getOrderWorkspace(orderId, { id: booster.id, role: "BOOSTER" } as any);
    expect(asBooster).not.toBeNull();
    expect(asBooster!.riot.account).toBeNull();
    expect(asBooster!.updates.selfCheck).toBeNull();
    expect(JSON.stringify(asBooster)).not.toContain("Faker");
    const asCustomer = await getOrderWorkspace(orderId, { id: customer.id, role: "CUSTOMER" } as any);
    expect(asCustomer!.riot.account).toMatchObject({ gameName: "Faker", tagLine: "KR1" });
  });
});
