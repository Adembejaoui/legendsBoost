/**
 * Customer order creation with a server-side price snapshot.
 *
 *   - CUSTOMER role re-read from the database;
 *   - authoritative server quote (lib/pricing/service.ts); browser prices
 *     are rejected by the strict request schema;
 *   - order created AWAITING_PAYMENT with paymentVerifiedAt NULL, together
 *     with an immutable OrderPricingSnapshot (45/55 split frozen) in one
 *     transaction;
 *   - Idempotency-Key per customer: a repeated submission returns the same
 *     order; reusing a key for a different request is rejected (409).
 */
import { createHash } from "node:crypto";
import { RISK_DISCLOSURE_VERSION } from "./risk-disclosure";
import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { toDecimalString } from "@/lib/money";
import { buildServerQuote, PricingError } from "@/lib/pricing/service";
import type { OrderRequest } from "@/lib/pricing/order-input";
import { assertPreferable } from "@/lib/pool/preferred";

/** A "priority-*" option (priority completion / scheduling) skips bidding. */
export function isPriorityOrder(selectedOptions: readonly string[]) {
  return selectedOptions.some((o) => o.startsWith("priority-"));
}

export class OrderCreationError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: string[]) {
    super(message);
    this.name = "OrderCreationError";
  }
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function requestHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function createOrderForCustomer(customerId: string, request: OrderRequest, idempotencyKey: string) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new OrderCreationError("A valid Idempotency-Key header is required.", 400);
  }
  const user = await prisma.user.findUnique({ where: { id: customerId }, select: { role: true } });
  if (!user || (user.role ?? "CUSTOMER") !== "CUSTOMER") {
    throw new OrderCreationError("Only customer accounts can place orders.", 403);
  }

  // Replay of an earlier submission with the same key.
  const existing = await prisma.order.findUnique({
    where: { userId_creationIdempotencyKey: { userId: customerId, creationIdempotencyKey: idempotencyKey } },
    include: { pricingSnapshot: true },
  });

  let server;
  try {
    server = await buildServerQuote(request, prisma, { customerId });
  } catch (e) {
    if (e instanceof PricingError) {
      if (existing) return { order: existing, replayed: true };
      throw new OrderCreationError(e.message, e.status, e.details);
    }
    throw e;
  }
  // The chosen booster is part of the request identity (same key, other booster = other request).
  const preferredBoosterId = request.preferredBoosterId ?? null;
  const hash = requestHash(preferredBoosterId ? { ...server.input, preferredBoosterId } : server.input);
  if (existing) {
    if (existing.creationRequestHash !== hash) {
      throw new OrderCreationError("This Idempotency-Key was already used for a different order.", 409);
    }
    return { order: existing, replayed: true };
  }
  // Never charge a different price than the one shown: a code that no
  // longer applies (expired, used up...) stops the order with the reason.
  if (server.coupon && !server.coupon.applied) {
    throw new OrderCreationError(server.coupon.reason ?? "This discount code cannot be used.", 409);
  }

  // VPN extra: the customer must choose the country (no default, client 2026-11-23).
  // Checked here, not in the quote, so the price still shows while they choose.
  if (server.input.selectedOptions.includes("vpn") && !server.input.championsRoles?.vpnCountry) {
    throw new OrderCreationError("Choose the country for the VPN.", 400);
  }

  const { input, quote } = server;
  if (preferredBoosterId) {
    try {
      await assertPreferable(preferredBoosterId, { gameSlug: input.gameSlug, serviceSlug: input.serviceSlug, configuration: input.configuration });
    } catch (e) {
      throw new OrderCreationError(e instanceof Error ? e.message : "The booster you chose is not available.", 409);
    }
  }
  try {
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: customerId,
          gameSlug: input.gameSlug,
          serviceSlug: input.serviceSlug,
          configuration: input.configuration as Prisma.InputJsonValue,
          selectedMode: input.selectedMode,
          selectedOptions: input.selectedOptions,
          championsRoles: (input.championsRoles ?? Prisma.DbNull) as Prisma.InputJsonValue,
          status: "AWAITING_PAYMENT",
          // Legacy display columns, derived exactly from the snapshot.
          price: new Prisma.Decimal(toDecimalString(quote.totalAmount, quote.currency)),
          currency: quote.currency,
          creationIdempotencyKey: idempotencyKey,
          creationRequestHash: hash,
          // The checkout no longer shows a risk checkbox (client decision
          // 2026-11-19): recorded only when the request still carries it.
          riskDisclosureAcceptedAt: request.riskAccepted === true ? new Date() : null,
          riskDisclosureVersion: request.riskAccepted === true ? RISK_DISCLOSURE_VERSION : null,
          isPriority: isPriorityOrder(input.selectedOptions),
          preferredBoosterId,
        },
      });
      await tx.orderPricingSnapshot.create({
        data: {
          orderId: created.id,
          currency: quote.currency,
          subtotalAmount: quote.subtotalAmount,
          discountAmount: quote.discountAmount,
          taxAmount: quote.taxAmount,
          totalAmount: quote.totalAmount,
          commissionBaseAmount: quote.commissionBaseAmount,
          platformFeeBps: quote.commission.platformFeeBps,
          boosterShareBps: quote.commission.boosterShareBps,
          platformFeeAmount: quote.commission.platformFeeAmount,
          boosterShareAmount: quote.commission.boosterShareAmount,
          commissionPolicyId: quote.commissionPolicyId,
          servicePriceId: quote.servicePriceId,
          servicePriceVersion: quote.servicePriceVersion,
          breakdown: { lines: quote.lines, ...(quote.fx ? { fx: quote.fx } : {}) } as unknown as Prisma.InputJsonValue,
          ...(server.coupon?.applied ? { couponId: server.coupon.couponId, couponCode: server.coupon.code } : {}),
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: created.id,
          type: "ORDER_CREATED",
          message: "Order created; awaiting payment",
          metadata: {
            actorUserId: customerId,
            totalAmount: quote.totalAmount,
            currency: quote.currency,
            servicePriceVersion: quote.servicePriceVersion,
          },
        },
      });
      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: { pricingSnapshot: true } });
    });
    return { order, replayed: false };
  } catch (e) {
    // Two identical submissions raced: return the one that won.
    if (isUniqueViolation(e)) {
      const winner = await prisma.order.findUnique({
        where: { userId_creationIdempotencyKey: { userId: customerId, creationIdempotencyKey: idempotencyKey } },
        include: { pricingSnapshot: true },
      });
      if (winner && winner.creationRequestHash === hash) return { order: winner, replayed: true };
      throw new OrderCreationError("This Idempotency-Key was already used for a different order.", 409);
    }
    throw e;
  }
}
