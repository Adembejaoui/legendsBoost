// Server-only module.
/**
 * "Poke booster" (client PDF 2026-11-21): the customer emails the booster who
 * holds the order that they need their attention. At most one poke per order
 * per hour, enforced by a conditional update on `order.boosterPokedAt`, so two
 * clicks at the same time still send one email.
 */
import prisma from "@/lib/prisma";
import { enqueueOutbox, dispatchOutbox } from "@/lib/payments/outbox";
import { HELD_ASSIGNMENT_STATUSES } from "./booster-change.service";

export const POKE_COOLDOWN_MS = 60 * 60 * 1000;

export class PokeError extends Error {
  constructor(message: string, public readonly status: number, public readonly nextPokeAt?: Date) {
    super(message);
    this.name = "PokeError";
  }
}

/** When the customer may poke again (null = now). */
export function nextPokeAt(boosterPokedAt: Date | null, now = new Date()): Date | null {
  if (!boosterPokedAt) return null;
  const next = new Date(boosterPokedAt.getTime() + POKE_COOLDOWN_MS);
  return next > now ? next : null;
}

export async function pokeBooster(customerId: string, orderId: string, now = new Date()) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      boosterPokedAt: true,
      assignments: { where: { status: { in: [...HELD_ASSIGNMENT_STATUSES] } }, select: { boosterId: true }, take: 1 },
    },
  });
  if (!order || order.userId !== customerId) throw new PokeError("Order not found", 404);
  const held = order.assignments[0];
  if (!held) throw new PokeError("There is no booster on this order yet.", 409);

  const cutoff = new Date(now.getTime() - POKE_COOLDOWN_MS);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, OR: [{ boosterPokedAt: null }, { boosterPokedAt: { lte: cutoff } }] },
      data: { boosterPokedAt: now },
    });
    if (claimed.count === 0) {
      const fresh = await tx.order.findUnique({ where: { id: orderId }, select: { boosterPokedAt: true } });
      const next = nextPokeAt(fresh?.boosterPokedAt ?? null, now);
      throw new PokeError("You already poked your booster recently.", 429, next ?? undefined);
    }
    await tx.orderEvent.create({ data: { orderId, type: "BOOSTER_POKED", message: "Customer poked the booster", metadata: { boosterId: held.boosterId } } });
    await enqueueOutbox(tx, [
      { type: "EMAIL_BOOSTER_POKE", dedupeKey: `poke:${orderId}:${now.getTime()}`, payload: { orderId, boosterId: held.boosterId } },
    ]);
  });
  await dispatchOutbox({ limit: 5 });
  return { pokedAt: now, nextPokeAt: new Date(now.getTime() + POKE_COOLDOWN_MS) };
}
