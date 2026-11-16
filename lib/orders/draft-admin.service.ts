/**
 * Admin-only management of DRAFT orders (orders a booster abandoned).
 *
 *   IN_PROGRESS/PAUSED --(booster abandons)--> DRAFT
 *   DRAFT --(admin edits)--> DRAFT           (event DRAFT_EDITED)
 *   DRAFT --(admin republishes)--> PENDING   (event ORDER_REPUBLISHED)
 *          requires a verified payment (Order.paymentVerifiedAt)
 *   DRAFT --(admin cancels, reason required)--> CANCELLED  (event ORDER_CANCELLED)
 *          refused for paid drafts (needs the future refund flow)
 *
 * Neither the customer nor the previous booster can republish. Every write
 * re-checks the actor's role in the database and the order status inside a
 * transaction, and leaves an audit event.
 */
import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { isTargetAboveCurrent } from "@/lib/catalog/rank-systems";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { createNotificationsForEvent } from "@/lib/notifications/service";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import { ACTIVE_ASSIGNMENT_STATUSES, validateOrderTransition } from "@/lib/assignments/types";
import { hasVerifiedPayment, PAYMENT_NOT_VERIFIED_MESSAGE, VERIFIED_PAYMENT_WHERE } from "@/lib/orders/payment-gate";
import { transitionOrder } from "./transitions";

export class DraftOrderError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DraftOrderError";
  }
}

export interface DraftOrderPatch {
  configuration?: Record<string, unknown>;
  selectedOptions?: string[];
  selectedMode?: "solo" | "duo" | null;
  championsRoles?: { roles: string[]; champions: string[] } | null;
  price?: string | null;
  currency?: string | null;
  note?: string;
}

async function assertAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u || u.role !== "ADMIN") throw new DraftOrderError("Only administrators can manage draft orders.", 403);
}

/** Validate an order configuration against its catalog offer. Returns errors. */
export function validateOrderConfiguration(
  gameSlug: string,
  serviceSlug: string,
  input: {
    configuration: Record<string, unknown>;
    selectedOptions: string[];
    selectedMode: string | null;
    price: string | null;
  }
): string[] {
  const errors: string[] = [];
  const offer = getGameServiceOffer(gameSlug, serviceSlug);
  if (!offer) return ["Unknown game/service combination."];
  for (const field of offer.fields ?? []) {
    const v = input.configuration[field.key];
    if (field.required && (v === undefined || v === null || v === "")) {
      errors.push(`Missing required field: ${field.label}`);
    }
    if (field.type === "number" && v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors.push(`${field.label} must be a number`);
      else if (field.min !== undefined && n < field.min) errors.push(`${field.label} must be at least ${field.min}`);
      else if (field.max !== undefined && n > field.max) errors.push(`${field.label} must be at most ${field.max}`);
    }
  }
  if (offer.rankSystemId && input.configuration.currentRank && input.configuration.targetRank) {
    const ok = isTargetAboveCurrent(
      offer.rankSystemId,
      input.configuration.currentRank as { tierId: string; divisionId: string | null },
      input.configuration.targetRank as { tierId: string; divisionId: string | null }
    );
    if (!ok) errors.push("Target rank must be above the current rank.");
  }
  const checkout = getCheckoutConfig(gameSlug, serviceSlug);
  if (checkout) {
    const known = new Set(checkout.options.map((o) => o.id));
    for (const o of input.selectedOptions) if (!known.has(o)) errors.push(`Unknown option: ${o}`);
    if (input.selectedMode && checkout.modes && !checkout.modes.some((m) => m.id === input.selectedMode)) {
      errors.push("Unknown boost mode.");
    }
  }
  if (input.price !== null && input.price !== undefined) {
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(input.price)) errors.push("Price must be a positive amount with up to 2 decimals.");
  }
  return errors;
}

export async function listDraftOrders() {
  const orders = await prisma.order.findMany({
    where: { status: "DRAFT" },
    orderBy: { updatedAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
      events: {
        where: { type: "BOOSTER_ABANDONED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  return orders.map((o) => {
    const ev = o.events[0];
    const meta = (ev?.metadata ?? {}) as { reason?: string | null };
    return {
      id: o.id,
      gameSlug: o.gameSlug,
      serviceSlug: o.serviceSlug,
      customer: o.user,
      price: o.price?.toString() ?? null,
      currency: o.currency,
      updatedAt: o.updatedAt.toISOString(),
      abandonedAt: ev?.createdAt.toISOString() ?? null,
      abandonReason: meta.reason ?? ev?.message ?? null,
    };
  });
}

function isSameAmount(a: string, b: string) {
  try {
    return new Prisma.Decimal(a).equals(new Prisma.Decimal(b));
  } catch {
    return false;
  }
}

export async function updateDraftOrder(orderId: string, adminId: string, patch: DraftOrderPatch) {
  await assertAdmin(adminId);
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { pricingSnapshot: { select: { id: true } } } });
    if (!order) throw new DraftOrderError("Order not found.", 404);
    if (order.status !== "DRAFT") throw new DraftOrderError("Only DRAFT orders can be edited.", 409);
    // A priced order's amount is its immutable snapshot (what the customer
    // paid); the legacy price/currency columns are display copies of it.
    // Sending the same price/currency back (a form that resubmits every
    // field) is not an edit and is ignored; only a real change is refused.
    if (order.pricingSnapshot) {
      const samePrice =
        patch.price === undefined ||
        (patch.price === null ? order.price === null : order.price !== null && isSameAmount(order.price.toString(), patch.price));
      const sameCurrency = patch.currency === undefined || patch.currency === order.currency;
      if (!samePrice || !sameCurrency) {
        throw new DraftOrderError("The price of a paid order cannot be edited. Use a refund for corrections.", 409);
      }
      patch = { ...patch, price: undefined, currency: undefined };
    }

    const next = {
      configuration: patch.configuration ?? ((order.configuration ?? {}) as Record<string, unknown>),
      selectedOptions: patch.selectedOptions ?? order.selectedOptions,
      selectedMode: patch.selectedMode === undefined ? order.selectedMode : patch.selectedMode,
      price: patch.price === undefined ? order.price?.toString() ?? null : patch.price,
    };
    const errors = validateOrderConfiguration(order.gameSlug, order.serviceSlug, next);
    if (errors.length) throw new DraftOrderError(errors.join(" "), 400);

    const changed = Object.keys(patch).filter((k) => k !== "note" && patch[k as keyof DraftOrderPatch] !== undefined);
    const updated = await tx.order.update({
      where: { id: orderId, status: "DRAFT" },
      data: {
        configuration: next.configuration as Prisma.InputJsonValue,
        selectedOptions: next.selectedOptions,
        selectedMode: next.selectedMode,
        ...(patch.championsRoles !== undefined
          ? { championsRoles: (patch.championsRoles ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
        ...(patch.price !== undefined ? { price: patch.price === null ? null : new Prisma.Decimal(patch.price) } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "DRAFT_EDITED",
        message: patch.note?.slice(0, 500) || "Draft order edited by admin",
        metadata: {
          actorUserId: adminId,
          changedFields: changed,
          previous: {
            configuration: order.configuration,
            selectedOptions: order.selectedOptions,
            selectedMode: order.selectedMode,
            price: order.price?.toString() ?? null,
          },
        } as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

export async function republishDraftOrder(orderId: string, adminId: string, note?: string) {
  await assertAdmin(adminId);
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { assignments: { where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, select: { id: true } } },
    });
    if (!order) throw new DraftOrderError("Order not found.", 404);
    if (order.status !== "DRAFT") throw new DraftOrderError("Only DRAFT orders can be republished.", 409);
    validateOrderTransition("DRAFT", "PENDING");
    if (order.assignments.length > 0) {
      throw new DraftOrderError("Order still has an active booster assignment.", 409);
    }
    // Republishing makes the order claimable, so it must not bypass the
    // payment requirement. There is no admin override.
    if (!hasVerifiedPayment(order)) {
      throw new DraftOrderError(PAYMENT_NOT_VERIFIED_MESSAGE, 409);
    }
    const errors = validateOrderConfiguration(order.gameSlug, order.serviceSlug, {
      configuration: (order.configuration ?? {}) as Record<string, unknown>,
      selectedOptions: order.selectedOptions,
      selectedMode: order.selectedMode,
      price: order.price?.toString() ?? null,
    });
    if (errors.length) throw new DraftOrderError(`Fix the draft before republishing: ${errors.join(" ")}`, 400);

    // Conditional on DRAFT (two admins racing cannot both republish) and on a
    // verified payment in the same statement.
    const updated = await transitionOrder(tx, {
      where: { id: orderId, status: "DRAFT", ...VERIFIED_PAYMENT_WHERE },
      to: "PENDING",
    });
    const event = await tx.orderEvent.create({
      data: {
        orderId,
        type: "ORDER_REPUBLISHED",
        message: note?.slice(0, 500) || "Order republished by admin and available to boosters",
        metadata: { actorUserId: adminId, previousStatus: "DRAFT" },
      },
    });
    return { order: updated, eventId: event.id };
  });

  await createNotificationsForEvent({
    type: "ORDER_REOPENED",
    orderId,
    actorId: adminId,
    dedupeKey: `ORDER_REPUBLISHED:${result.eventId}`,
  });
  await broadcastToOrder({
    orderId,
    event: "order.status_changed",
    payload: {
      orderId,
      customerId: result.order.userId,
      boosterId: null,
      previousStatus: "DRAFT",
      newStatus: "PENDING",
      changedAt: new Date().toISOString(),
    },
  });
  // Live: back in every booster's available orders.
  await (await import("@/lib/realtime/live")).signalPool("added");
  return result.order;
}

export const DRAFT_CANCEL_REASON_MIN_LENGTH = 3;
export const DRAFT_CANCEL_REASON_MAX_LENGTH = 500;

/**
 * Admin cancels a DRAFT (abandoned) order. A reason is mandatory and stored
 * in the audit event. Assignment history is left untouched.
 *
 * An order with a verified payment cannot be cancelled here: that requires a
 * refund, and the refund flow does not exist yet.
 */
export async function cancelDraftOrder(orderId: string, adminId: string, reason: string) {
  await assertAdmin(adminId);
  const cleanReason = (reason ?? "").trim();
  if (cleanReason.length < DRAFT_CANCEL_REASON_MIN_LENGTH) {
    throw new DraftOrderError("A cancellation reason is required.", 400);
  }
  if (cleanReason.length > DRAFT_CANCEL_REASON_MAX_LENGTH) {
    throw new DraftOrderError(`The reason must be at most ${DRAFT_CANCEL_REASON_MAX_LENGTH} characters.`, 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { assignments: { where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, select: { id: true } } },
    });
    if (!order) throw new DraftOrderError("Order not found.", 404);
    if (order.status !== "DRAFT") throw new DraftOrderError("Only DRAFT orders can be cancelled here.", 409);
    validateOrderTransition("DRAFT", "CANCELLED");
    if (order.assignments.length > 0) {
      throw new DraftOrderError("Order still has an active booster assignment.", 409);
    }
    if (hasVerifiedPayment(order)) {
      throw new DraftOrderError(
        "This order has a verified payment. Cancelling it requires a refund, which is not available yet.",
        409
      );
    }

    // Conditional on DRAFT and still unpaid: a concurrent republish or
    // payment confirmation makes this a no-op error instead of a lost update.
    const updated = await transitionOrder(tx, {
      where: { id: orderId, status: "DRAFT", paymentVerifiedAt: null },
      to: "CANCELLED",
    });
    const event = await tx.orderEvent.create({
      data: {
        orderId,
        type: "ORDER_CANCELLED",
        message: cleanReason,
        metadata: { actorUserId: adminId, cancelledBy: "ADMIN", previousStatus: "DRAFT", reason: cleanReason },
      },
    });
    return { order: updated, eventId: event.id };
  });

  await createNotificationsForEvent({
    type: "ORDER_CANCELLED",
    orderId,
    actorId: adminId,
    dedupeKey: `ORDER_CANCELLED:${orderId}`,
  });
  await broadcastToOrder({
    orderId,
    event: "order.status_changed",
    payload: {
      orderId,
      customerId: result.order.userId,
      boosterId: null,
      previousStatus: "DRAFT",
      newStatus: "CANCELLED",
      changedAt: new Date().toISOString(),
    },
  });
  return result.order;
}
