// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Phase 4 against an in-memory PostgreSQL (all migrations): the Riot check on
 * "Complete" (admin review when not confirmed), play sessions required to
 * reveal the login (reveal log with IP), no login on duo orders, and the chat
 * filter (contact / payment details hidden and flagged for admins).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
  stripe: null as any,
}));

// The real completion check (the global test setup replaces it elsewhere).
vi.unmock("@/lib/orders/completion-check");
vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/realtime/broadcast", () => ({ revokeOrderAccess: vi.fn(), broadcastToOrder: vi.fn(), broadcastToUser: vi.fn() }));
// Never call Riot from tests: the rank is whatever the test wrote.
vi.mock("@/lib/services/games/league-of-legends/sync.service", () => ({ syncOrderRiotData: vi.fn(async () => ({ status: "ok" })) }));
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
import { claimAndStart, configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser } from "../support/payment-fixtures";
import { checkCompletion } from "@/lib/orders/completion-check";
import { completeAssignment, setCustomerOrderPaused } from "@/lib/assignments/service";
import { CompletionNotConfirmedError } from "@/lib/assignments/types";
import { revealCredentials, saveCredentials } from "@/lib/orders/account-credentials.service";
import { endSession, getOpenSession, startSession } from "@/lib/orders/sessions.service";
import { moderateChatText } from "@/lib/chat/moderation";
import { getOrCreateConversation, sendMessage } from "@/lib/chat/service";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string };
let customer: { id: string; role: string };

/** Paid Gold IV -> Gold I order, taken and started by a new booster. */
async function workingOrder() {
  const { orderId } = await createPaidOrder(customer.id);
  const booster = await seedUser("BOOSTER");
  const { assignment } = await claimAndStart(orderId, booster.id);
  return { orderId, booster, assignmentId: assignment.id };
}

async function setRiotRank(orderId: string, tier: string, division: string | null, lp: number, observedAt = new Date()) {
  await prisma.orderRiotAccount.upsert({
    where: { orderId },
    create: { orderId, gameName: "Test", tagLine: "EUW", platform: "EUW1", observedTier: tier, observedDivision: division, observedLp: lp, observedAt },
    update: { observedTier: tier, observedDivision: division, observedLp: lp, observedAt },
  });
}

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
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.stripe = createFakeStripe();
});

describe("chat filter", () => {
  it("hides contact and payment details", () => {
    const cases: [string, string][] = [
      ["mail me at john.doe@gmail.com", "EMAIL"],
      ["john at gmail dot com", "EMAIL"],
      ["call +33 6 12 34 56 78 tonight", "PHONE"],
      ["join discord.gg/abcd123", "DISCORD"],
      ["add me Booster#1234", "DISCORD"],
      ["my discord: coolguy99", "DISCORD"],
      ["t.me/someone", "MESSENGER"],
      ["telegram @someone", "MESSENGER"],
      ["pay me on paypal instead", "PAYMENT"],
      ["IBAN FR76 3000 6000 0112 3456 7890 189", "PAYMENT"],
      ["send to 0x52908400098527886E0F7030069857D2E4169EE7", "PAYMENT"],
      ["btc bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "PAYMENT"],
    ];
    for (const [text, kind] of cases) {
      const r = moderateChatText(text);
      expect(r.kinds, text).toContain(kind);
      expect(r.text, text).toContain("[hidden]");
    }
  });

  it("leaves normal game talk alone", () => {
    for (const text of [
      "Reached Gold 2 with 75 LP, 3 wins left",
      "Played 12 games today, 9 wins",
      "Check op.gg/summoners/euw/Test-EUW for the history",
      "I will play mid and jungle, Ahri and Lee Sin",
      "Order total was 49.99 EUR",
    ]) {
      expect(moderateChatText(text)).toEqual({ text, kinds: [] });
    }
  });

  it("stores the message with details hidden, keeps the original for admins and notifies them", async () => {
    const { orderId } = await createPaidOrder(customer.id);
    const conv = await getOrCreateConversation(orderId);
    const msg = await sendMessage(conv.id, customer.id, "add me on discord: player123 or mail p@x.io", orderId, null, { senderRole: "CUSTOMER" });
    expect(msg.moderated.sort()).toEqual(["DISCORD", "EMAIL"]);
    const stored = await prisma.orderMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(stored.content).not.toContain("player123");
    expect(stored.content).not.toContain("p@x.io");
    const flag = await prisma.chatModerationFlag.findUniqueOrThrow({ where: { messageId: msg.id } });
    expect(flag.original).toContain("player123");
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "CHAT_FLAGGED", orderId } })).toBe(1);

    const fromAdmin = await sendMessage(conv.id, admin.id, "Write to support@legendsboost.test", orderId, null, { senderRole: "ADMIN" });
    expect(fromAdmin.moderated).toEqual([]);
    expect((await prisma.orderMessage.findUniqueOrThrow({ where: { id: fromAdmin.id } })).content).toContain("support@");
  });
});

describe("Complete: Riot check", () => {
  it("target reached in Riot: the order completes", async () => {
    const { orderId, booster, assignmentId } = await workingOrder();
    await setRiotRank(orderId, "GOLD", "I", 10);
    expect((await checkCompletion(orderId)).result).toBe("reached");
    await completeAssignment(assignmentId, booster.id, "BOOSTER");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("COMPLETED");
  });

  it("not reached: the order stays in progress, admins are told, and an admin can still complete it", async () => {
    const { orderId, booster, assignmentId } = await workingOrder();
    await setRiotRank(orderId, "GOLD", "III", 40);
    const err = await completeAssignment(assignmentId, booster.id, "BOOSTER").catch((e) => e);
    expect(err).toBeInstanceOf(CompletionNotConfirmedError);
    expect(err).toMatchObject({ result: "not_reached" });
    expect(err.reason).toMatch(/Gold III/i);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("IN_PROGRESS");
    expect(await prisma.orderEvent.count({ where: { orderId, type: "COMPLETION_NOT_CONFIRMED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "COMPLETION_REVIEW", orderId } })).toBe(1);
    // A second click within the hour does not notify admins again.
    await completeAssignment(assignmentId, booster.id, "BOOSTER").catch(() => {});
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "COMPLETION_REVIEW", orderId } })).toBe(1);

    await completeAssignment(assignmentId, admin.id, "ADMIN");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("COMPLETED");
  });

  it("an old Riot observation or a service Riot cannot check goes to an admin", async () => {
    const { orderId } = await workingOrder();
    await setRiotRank(orderId, "GOLD", "I", 10, new Date(Date.now() - 60 * 60_000));
    expect(await checkCompletion(orderId)).toMatchObject({ result: "cannot_verify" });
    await prisma.order.update({ where: { id: orderId }, data: { gameSlug: "valorant" } });
    expect(await checkCompletion(orderId)).toMatchObject({ result: "cannot_verify", reason: expect.stringMatching(/cannot be checked/) });
  });
});

describe("sessions and the login", () => {
  it("the login can be revealed only during a session; every reveal is logged with the IP", async () => {
    const { orderId, booster } = await workingOrder();
    await saveCredentials(orderId, customer.id, { username: "acc_login", password: "s3cret!" });

    await expect(revealCredentials(orderId, booster.id, { ip: "203.0.113.5" })).rejects.toMatchObject({ status: 403 });
    await expect(startSession(orderId, booster.id, { rulesAccepted: false })).rejects.toMatchObject({ status: 400 });

    const session = await startSession(orderId, booster.id, { rulesAccepted: true, ip: "203.0.113.5", userAgent: "test" });
    expect((await startSession(orderId, booster.id, { rulesAccepted: true })).id).toBe(session.id); // one open session
    expect(await prisma.notification.count({ where: { userId: customer.id, type: "SESSION_STARTED", orderId } })).toBe(1);

    const creds = await revealCredentials(orderId, booster.id, { ip: "203.0.113.5", userAgent: "test" });
    expect(creds).toEqual({ username: "acc_login", password: "s3cret!" });
    const log = await prisma.orderCredentialReveal.findMany({ where: { orderId } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ boosterId: booster.id, sessionId: session.id, ip: "203.0.113.5" });

    await endSession(orderId, booster.id);
    await expect(revealCredentials(orderId, booster.id)).rejects.toMatchObject({ status: 403 });
  });

  it("a customer pause ends the session and blocks the login", async () => {
    const { orderId, booster } = await workingOrder();
    await saveCredentials(orderId, customer.id, { username: "acc_login", password: "pw" });
    await startSession(orderId, booster.id, { rulesAccepted: true });
    await setCustomerOrderPaused(orderId, customer.id, "pause");
    expect(await getOpenSession(orderId, booster.id)).toBeNull();
    const s = await prisma.orderSession.findFirstOrThrow({ where: { orderId } });
    expect(s.endReason).toBe("PAUSED");
    await expect(revealCredentials(orderId, booster.id)).rejects.toMatchObject({ status: 403 });
    await expect(startSession(orderId, booster.id, { rulesAccepted: true })).rejects.toMatchObject({ status: 409 });
  });

  it("duo orders never store or reveal a login", async () => {
    const { orderId, booster } = await workingOrder();
    await prisma.order.update({ where: { id: orderId }, data: { selectedMode: "duo" } });
    await expect(saveCredentials(orderId, customer.id, { username: "x", password: "y" })).rejects.toMatchObject({ status: 409 });
    await startSession(orderId, booster.id, { rulesAccepted: true });
    await expect(revealCredentials(orderId, booster.id)).rejects.toMatchObject({ status: 403 });
  });
});
