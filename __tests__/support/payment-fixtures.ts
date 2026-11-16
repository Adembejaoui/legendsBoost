/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
/**
 * Shared fixtures for the Postgres-backed payment tests. Test files must
 * mock @/lib/prisma (pg-test-db), @/lib/stripe/server (fake client),
 * notifications, realtime and the catalog the same way; see
 * __tests__/payments/payment-flow.test.ts.
 */
import type { NextRequest } from "next/server";
import { getTestPrisma, uid } from "./pg-test-db";
import { signEvent, stripeEvent } from "./fake-stripe";

export const rankOffer = {
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  title: "Rank Boost",
  rankSystemId: "lol-ranked",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
  fields: [
    { type: "rank-picker", key: "currentRank", label: "Current rank", required: true, rankSystemId: "lol-ranked" },
    { type: "rank-picker", key: "targetRank", label: "Target rank", required: true, rankSystemId: "lol-ranked" },
  ],
};
export const rankCheckout = {
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  availability: "available",
  visibility: "visible",
  orderCapability: "live-order",
  complianceStatus: "approved",
  allowOrder: true,
  options: [],
};

export async function seedUser(role: "ADMIN" | "CUSTOMER" | "BOOSTER", id = uid(role.toLowerCase())) {
  const prisma = await getTestPrisma();
  await prisma.user.create({
    data: {
      id,
      email: `${id}@t.test`,
      name: id,
      role,
      ...(role === "BOOSTER"
        ? {
            boosterProfile: {
              create: {
                verificationStatus: "APPROVED",
                // Phase 7: payouts need a verified identity (and a payout method, below).
                kycStatus: "VERIFIED",
                // Every game, no practical rank cap (pool tests set their own).
                permissions: {
                  create: [
                    { gameSlug: "league-of-legends", rankSystemId: "lol-ranked", maxTargetRankValue: 1000, maxTargetTierId: "challenger" },
                    { gameSlug: "valorant", rankSystemId: "valorant-competitive", maxTargetRankValue: 1000, maxTargetTierId: "radiant" },
                    { gameSlug: "teamfight-tactics", rankSystemId: "tft-ranked", maxTargetRankValue: 1000, maxTargetTierId: "challenger" },
                  ],
                },
              },
            },
          }
        : {}),
    },
  });
  if (role === "BOOSTER") {
    // A ready payout method (not a recent change). Placeholder ciphertext:
    // payout tests that read it set a real one with setPayoutMethod.
    await prisma.boosterPayoutMethod.create({ data: { boosterId: id, type: "PAYPAL", ciphertext: "v1.test.test.test", hint: "PayPal te•••@t.test", replaced: false } });
  }
  return { id, role };
}

/** Override one AppConfig key for this test database (and drop the config cache). */
export async function setConfig(key: string, value: unknown) {
  const prisma = await getTestPrisma();
  await prisma.appConfig.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } });
  const { clearConfigCache } = await import("@/lib/config");
  clearConfigCache();
}

/** Take an order now and start it (CLAIMED -> IN_PROGRESS), as a booster does. */
export async function claimAndStart(orderId: string, boosterId: string) {
  const { claimOrder, startAssignment } = await import("@/lib/assignments/service");
  const claimed = await claimOrder(orderId, boosterId);
  await startAssignment(orderId, boosterId);
  return claimed;
}

/** Configure a price: Gold IV -> Gold I = base + 3 steps. */
export async function configurePrice(adminId: string, baseAmount: number, stepAmount: number) {
  const { createServicePriceVersion } = await import("@/lib/pricing/admin.service");
  return createServicePriceVersion(adminId, {
    gameSlug: "league-of-legends",
    serviceSlug: "rank-boost",
    currency: "EUR",
    pricingModel: "RANK_STEPS",
    baseAmount,
    stepAmounts: { gold: stepAmount },
  });
}

export async function createOrder(customerId: string) {
  const { createOrderForCustomer } = await import("@/lib/orders/order-creation.service");
  const { order } = await createOrderForCustomer(
    customerId,
    {
      gameSlug: "league-of-legends",
      serviceSlug: "rank-boost",
      configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "gold", divisionId: "i" } },
      selectedOptions: [],
      riskAccepted: true,
    } as any,
    uid("idem-key-fixture")
  );
  return order;
}

export async function startCheckout(customerId: string, orderId: string) {
  const { createCheckoutForOrder } = await import("@/lib/payments/checkout.service");
  return createCheckoutForOrder(customerId, orderId);
}

/** The Checkout Session object Stripe would send for a payment row. */
export async function sessionFor(paymentId: string, overrides: Record<string, unknown> = {}) {
  const prisma = await getTestPrisma();
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  return {
    id: p.stripeCheckoutSessionId,
    object: "checkout.session",
    amount_total: p.amount,
    currency: p.currency.toLowerCase(),
    payment_status: "paid",
    payment_intent: `pi_for_${p.id}`,
    client_reference_id: p.orderId,
    metadata: { orderId: p.orderId, paymentId: p.id, customerId: p.customerId },
    ...overrides,
  };
}

export async function deliver(event: Record<string, unknown>, opts: { badSignature?: boolean; noSignature?: boolean } = {}) {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const { payload, header } = signEvent(event, opts.badSignature ? "whsec_wrong" : undefined);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.noSignature) headers["stripe-signature"] = header;
  const res = await POST(new Request("http://t/api/webhooks/stripe", { method: "POST", headers, body: payload }) as unknown as NextRequest);
  return { status: res.status, body: await res.json() };
}

/** Create an order, open checkout and deliver a paid checkout.session.completed. */
export async function createPaidOrder(customerId: string) {
  const order = await createOrder(customerId);
  const { paymentId } = await startCheckout(customerId, order.id);
  const res = await deliver(stripeEvent("checkout.session.completed", await sessionFor(paymentId)));
  if (res.status !== 200) throw new Error(`payment webhook failed: ${JSON.stringify(res.body)}`);
  return { orderId: order.id, paymentId };
}

export async function ledgerFor(orderId: string) {
  const prisma = await getTestPrisma();
  return prisma.financialTransaction.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
}

export function sum(rows: { amount: number; account?: string; type?: string }[], f: (r: any) => boolean) {
  return rows.filter(f).reduce((a, r) => a + r.amount, 0);
}
