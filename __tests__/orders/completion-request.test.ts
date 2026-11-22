// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Completion with proof, decided by an admin (client PDFs 2026-11-22)
 * against an in-memory PostgreSQL (all migrations): booster submits
 * screenshots, the customer sees them and may report a problem, an admin
 * marks the order Completed (payout Frozen -> Available) or sends it back.
 * No customer confirmation, no auto-confirm, Riot never completes alone.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  offers: [] as any[],
  checkouts: [] as any[],
  stripe: null as any,
  files: new Map<string, Uint8Array>(),
  emails: [] as any[],
}));

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
vi.mock("@/lib/email/send", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(async (m: any) => {
    h.emails.push(m);
    return { sent: true };
  }),
  emailConfigured: () => true,
}));

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { createFakeStripe, WEBHOOK_SECRET } from "../support/fake-stripe";
import { claimAndStart, configurePrice, createPaidOrder, rankCheckout, rankOffer, seedUser, setConfig } from "../support/payment-fixtures";
import { setProofStoreForTest, sniffImageType, validateProofFiles } from "@/lib/storage/order-proofs";
import {
  adminAcceptCompletion,
  adminSendBack,
  disputeByCustomer,
  submitCompletion,
} from "@/lib/orders/completion-request.service";
import { loadBoosterForPool } from "@/lib/pool/service";
import { boosterBalances } from "@/lib/finance/queries";
import { resolveWorkspaceAccess, WORKSPACE_ACCESS_SELECT } from "@/lib/orders/workspace-access";
import { dispatchOutbox } from "@/lib/payments/outbox";
import { POST as completeRoute } from "@/app/api/booster/orders/[orderId]/complete/route";
import { POST as completionRoute } from "@/app/api/orders/[orderId]/completion/route";
import { GET as proofRoute } from "@/app/api/orders/[orderId]/proofs/[proofId]/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string; role: string };

const PNG = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], { type: "image/png" });
const JPG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9])], { type: "image/jpeg" });
const noRiot = async () => false;

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_URL = "https://app.test";
  prisma = await getTestPrisma();
  h.offers.push(rankOffer);
  h.checkouts.push(rankCheckout);
  admin = await seedUser("ADMIN");
  await configurePrice(admin.id, 2500, 2500);
  await setConfig("claim_now_discount_bps", 0);
  setProofStoreForTest({
    put: async (p, b) => void h.files.set(p, b),
    get: async (p) => h.files.get(p) ?? null,
    remove: async (ps) => ps.forEach((p) => h.files.delete(p)),
  });
}, 60_000);
afterAll(async () => {
  setProofStoreForTest(null);
  await closeTestDb();
});
beforeEach(() => {
  h.stripe = createFakeStripe();
  h.emails.length = 0;
});

/** Paid order, claimed and started by a fresh booster. */
async function working() {
  const customer = await seedUser("CUSTOMER");
  const booster = await seedUser("BOOSTER");
  const { orderId } = await createPaidOrder(customer.id);
  await claimAndStart(orderId, booster.id);
  const a = await prisma.orderBoosterAssignment.findFirstOrThrow({ where: { orderId, boosterId: booster.id } });
  return { customer, booster, orderId, assignmentId: a.id };
}

const statusOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

describe("proof files", () => {
  it("are recognised by their bytes, limited in number and size", async () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    await expect(validateProofFiles([])).rejects.toThrow(/at least one/);
    await expect(validateProofFiles([PNG(), PNG(), PNG(), PNG()])).rejects.toThrow(/at most 3/);
    await expect(validateProofFiles([new Blob(["<html>"], { type: "image/png" })])).rejects.toThrow(/PNG, JPG or WebP/);
    await expect(validateProofFiles([new Blob([new Uint8Array(4 * 1024 * 1024 + 1)])])).rejects.toThrow(/too large|4 MB/);
    expect(await validateProofFiles([PNG(), JPG()])).toHaveLength(2);
  });
});

describe("booster submits a completion", () => {
  it("waits for an admin: order AWAITING_CONFIRMATION, booster freed, customer and admins told", async () => {
    const w = await working();
    await expect(submitCompletion({ ...w, boosterId: w.booster.id, files: [], riotCheck: noRiot })).rejects.toThrow(/at least one/);

    const r = await submitCompletion({ ...w, boosterId: w.booster.id, files: [PNG(), JPG()], note: "Reached Gold I", riotCheck: noRiot });
    expect(r.status).toBe("PENDING");
    expect(await statusOf(w.orderId)).toBe("AWAITING_CONFIRMATION");
    const a = await prisma.orderBoosterAssignment.findUniqueOrThrow({ where: { id: w.assignmentId } });
    expect(a.status).toBe("SUBMITTED");
    expect(a.activeOrderId).toBe(w.orderId); // keeps the workspace and chat
    const req = await prisma.orderCompletionRequest.findUniqueOrThrow({ where: { id: r.requestId }, include: { proofs: true } });
    expect(req.boosterNote).toBe("Reached Gold I");
    expect(req.proofs).toHaveLength(2);
    for (const p of req.proofs) expect(h.files.has(p.storagePath)).toBe(true);

    // The booster can take another order while waiting.
    expect((await loadBoosterForPool(w.booster.id)).activeCount).toBe(0);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: w.orderId }, select: WORKSPACE_ACCESS_SELECT });
    const ba = resolveWorkspaceAccess({ id: w.booster.id, role: "BOOSTER" }, order)!;
    expect(ba).toMatchObject({ canChat: true, canCompleteOrder: false, canAbandonOrder: false });
    expect(resolveWorkspaceAccess({ id: w.customer.id, role: "CUSTOMER" }, order)).toMatchObject({ readOnly: false, canPauseOrder: false });

    await dispatchOutbox({ limit: 50 });
    expect(await prisma.notification.findFirst({ where: { userId: w.customer.id, type: "COMPLETION_SUBMITTED" } })).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "COMPLETION_REVIEW", orderId: w.orderId } })).toBe(1);
    const mail = h.emails.find((e) => e.to === `${w.customer.id}@t.test` && /is done$/.test(e.subject));
    expect(mail?.action?.url).toBe(`https://app.test/dashboard/${w.orderId}`);
    expect(mail?.text).not.toMatch(/automatically/);

    // A second submission is refused.
    await expect(submitCompletion({ ...w, boosterId: w.booster.id, files: [PNG()], riotCheck: noRiot })).rejects.toMatchObject({ status: 409 });
  });

  it("Riot never completes the order on its own: an admin decides", async () => {
    const w = await working();
    const r = await submitCompletion({ ...w, boosterId: w.booster.id, files: [PNG()], riotCheck: async () => true });
    expect(r.status).toBe("PENDING");
    expect(await statusOf(w.orderId)).toBe("AWAITING_CONFIRMATION");
  });

  it("another booster cannot submit", async () => {
    const w = await working();
    const other = await seedUser("BOOSTER");
    await expect(submitCompletion({ ...w, boosterId: other.id, files: [PNG()], riotCheck: noRiot })).rejects.toMatchObject({ status: 404 });
  });
});

describe("admin decides", () => {
  it("Mark Completed completes the order once and releases the payout at once", async () => {
    const w = await working();
    const r = await submitCompletion({ ...w, boosterId: w.booster.id, files: [PNG()], riotCheck: noRiot });
    await adminAcceptCompletion(r.requestId, admin.id);
    expect(await statusOf(w.orderId)).toBe("COMPLETED");
    const a = await prisma.orderBoosterAssignment.findUniqueOrThrow({ where: { id: w.assignmentId } });
    expect(a).toMatchObject({ status: "COMPLETED", activeOrderId: null });
    const earning = await prisma.boosterEarning.findFirstOrThrow({ where: { orderId: w.orderId } });
    expect(earning).toMatchObject({ status: "AVAILABLE", boosterId: w.booster.id });
    await expect(adminAcceptCompletion(r.requestId, admin.id)).rejects.toMatchObject({ status: 409 });
  });

  it("a reported problem goes to the admin, who sends it back, then completes the next try", async () => {
    const w = await working();
    const first = await submitCompletion({ ...w, boosterId: w.booster.id, files: [PNG()], riotCheck: noRiot });
    await expect(disputeByCustomer(w.orderId, w.customer.id, "short")).rejects.toMatchObject({ status: 400 });
    const other = await seedUser("CUSTOMER");
    await expect(disputeByCustomer(w.orderId, other.id, "The account is still Gold III, not Gold I.")).rejects.toMatchObject({ status: 404 });
    await disputeByCustomer(w.orderId, w.customer.id, "The account is still Gold III, not Gold I.");
    expect((await prisma.orderCompletionRequest.findUniqueOrThrow({ where: { id: first.requestId } })).status).toBe("DISPUTED");
    await dispatchOutbox({ limit: 50 });
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "COMPLETION_DISPUTED", orderId: w.orderId } })).toBe(1);

    await expect(adminSendBack(first.requestId, admin.id, "no")).rejects.toMatchObject({ status: 400 });
    await adminSendBack(first.requestId, admin.id, "Play until Gold I and send a new screenshot.");
    expect(await statusOf(w.orderId)).toBe("IN_PROGRESS");
    expect((await prisma.orderBoosterAssignment.findUniqueOrThrow({ where: { id: w.assignmentId } })).status).toBe("IN_PROGRESS");
    await expect(adminAcceptCompletion(first.requestId, admin.id)).rejects.toMatchObject({ status: 409 }); // already handled

    const second = await submitCompletion({ ...w, boosterId: w.booster.id, files: [JPG()], riotCheck: noRiot });
    await adminAcceptCompletion(second.requestId, admin.id, "Checked op.gg");
    expect(await statusOf(w.orderId)).toBe("COMPLETED");
    expect((await prisma.orderCompletionRequest.findUniqueOrThrow({ where: { id: second.requestId } })).status).toBe("ADMIN_ACCEPTED");
  });
});

describe("booster dashboard balances", () => {
  it("the payout is Frozen from the claim to the admin's Completed, then Available", async () => {
    const w = await working();
    const assignment = await prisma.orderBoosterAssignment.findUniqueOrThrow({
      where: { id: w.assignmentId },
      include: { order: { include: { pricingSnapshot: true } } },
    });
    const payout = assignment.payoutAmount ?? assignment.order.boosterPayoutAmount ?? assignment.order.pricingSnapshot!.boosterShareAmount;
    const cur = assignment.order.pricingSnapshot!.currency;

    let b = await boosterBalances(w.booster.id);
    expect(b.frozen).toEqual({ [cur]: payout });
    expect(b.available).toEqual({});

    const r = await submitCompletion({ ...w, boosterId: w.booster.id, files: [PNG()], riotCheck: noRiot });
    b = await boosterBalances(w.booster.id);
    expect(b.waitingForReview).toBe(1);
    expect(b.frozen).toEqual({ [cur]: payout });

    await adminAcceptCompletion(r.requestId, admin.id);
    b = await boosterBalances(w.booster.id);
    const earning = await prisma.boosterEarning.findFirstOrThrow({ where: { orderId: w.orderId } });
    expect(b.waitingForReview).toBe(0);
    expect(b.frozen).toEqual({});
    expect(b.available).toEqual({ [earning.currency]: earning.grossAmount - earning.reversedAmount });
  });
});

describe("routes", () => {
  const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) });

  it("booster uploads with a form; proofs are visible to the order's people only; no customer confirmation", async () => {
    const w = await working();
    h.getSessionUser.mockResolvedValue({ id: w.booster.id, role: "BOOSTER" });
    const form = new FormData();
    form.set("assignmentId", w.assignmentId);
    form.append("proof", new File([await PNG().arrayBuffer()], "rank.png", { type: "image/png" }));
    const res = await completeRoute(new Request("http://t/x", { method: "POST", body: form }), params(w.orderId));
    expect(res.status).toBe(200);
    expect((await res.json()).completion.status).toBe("PENDING");

    const proof = await prisma.orderCompletionProof.findFirstOrThrow({ where: { orderId: w.orderId } });
    const get = (userId: string, role: string) => {
      h.getSessionUser.mockResolvedValue({ id: userId, role });
      return proofRoute(new Request("http://t/x"), { params: Promise.resolve({ orderId: w.orderId, proofId: proof.id }) });
    };
    const ok = await get(w.customer.id, "CUSTOMER");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect((await get(admin.id, "ADMIN")).status).toBe(200);
    const stranger = await seedUser("CUSTOMER");
    expect((await get(stranger.id, "CUSTOMER")).status).toBe(404);

    const post = (body: unknown) => completionRoute(new Request("http://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), params(w.orderId));
    h.getSessionUser.mockResolvedValue({ id: w.booster.id, role: "BOOSTER" });
    expect((await post({ action: "dispute", reason: "The rank is not reached yet." })).status).toBe(403);
    h.getSessionUser.mockResolvedValue({ id: w.customer.id, role: "CUSTOMER" });
    expect((await post({ action: "confirm" })).status).toBe(400); // confirmation removed
    expect(await statusOf(w.orderId)).toBe("AWAITING_CONFIRMATION");
    expect((await post({ action: "dispute", reason: "short" })).status).toBe(400);
    expect((await post({ action: "dispute", reason: "The rank is not reached yet." })).status).toBe(200);
  });

  it("a booster form without screenshots is refused", async () => {
    const w = await working();
    h.getSessionUser.mockResolvedValue({ id: w.booster.id, role: "BOOSTER" });
    const form = new FormData();
    form.set("assignmentId", w.assignmentId);
    const res = await completeRoute(new Request("http://t/x", { method: "POST", body: form }), params(w.orderId));
    expect(res.status).toBe(400);
    expect(await statusOf(w.orderId)).toBe("IN_PROGRESS");
  });
});
