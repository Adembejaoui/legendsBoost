// Server-only module.
/**
 * Strikes, fines and appeals (Phase 6, decisions 2026-11-15).
 *
 *   Strikes: added for a late release, a missed start and every fine.
 *            Counted and shown; no automatic suspension. Admins can remove.
 *   Fines:   issued by admins only, from the published schedule (config
 *            fine_schedule, amount adjustable). Ledger: BOOSTER_PAYABLE ->
 *            PLATFORM_REVENUE. Taken off the booster's next payout
 *            (lib/finance/payouts.ts). Never applied automatically.
 *   Appeals: the booster appeals a fine once; an admin accepts (the fine is
 *            reversed: opposite ledger entry, strike removed, and the amount
 *            returned as an AVAILABLE earning if it was already deducted
 *            from a paid payout) or rejects (UPHELD).
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { postLedger } from "@/lib/finance/ledger";
import { writeAudit } from "@/lib/finance/audit";
import { formatMoney } from "@/lib/money";
import { createNotification } from "@/lib/notifications/service";
import { logger } from "@/lib/logger";

type Tx = Prisma.TransactionClient;

export class DisciplineError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DisciplineError";
  }
}

export const STRIKE_WINDOW_DAYS = 30;

export const STRIKE_LABEL: Record<string, string> = {
  LATE_RELEASE: "Order dropped after the grace window",
  SLA_START: "Order not started in time",
  FINE: "Fine",
};

async function assertAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u || u.role !== "ADMIN") throw new DisciplineError("Only administrators can do this.", 403);
}

function notify(userId: string, type: "STRIKE_ADDED" | "FINE_ISSUED" | "FINE_APPEAL_DECIDED", orderId: string | null, meta: Record<string, unknown>, actorId: string, dedupeKey: string) {
  return createNotification(userId, type, orderId ?? undefined, meta, actorId, { dedupeKey }).catch((e) =>
    logger.warn("Discipline notification failed", { type, error: e instanceof Error ? e.message : "unknown" })
  );
}

/* ------------------------------------------------------------------ */
/* Strikes                                                             */
/* ------------------------------------------------------------------ */

export async function addStrike(
  db: Tx | typeof prisma,
  s: { boosterId: string; orderId?: string | null; code: string; note?: string | null; createdById?: string | null; fineId?: string | null }
) {
  return db.boosterStrike.create({
    data: {
      boosterId: s.boosterId,
      orderId: s.orderId ?? null,
      code: s.code,
      note: s.note?.slice(0, 500) ?? null,
      createdById: s.createdById ?? null,
      fineId: s.fineId ?? null,
    },
  });
}

/** Tell the booster about a strike created inside a transaction (after commit). */
export function notifyStrike(strike: { id: string; boosterId: string; orderId: string | null; code: string }, actorId = "system") {
  return notify(strike.boosterId, "STRIKE_ADDED", strike.orderId, { reason: STRIKE_LABEL[strike.code] ?? strike.code }, actorId, `strike:${strike.id}`);
}

export async function removeStrike(adminId: string, strikeId: string, reason: string) {
  await assertAdmin(adminId);
  const r = reason?.trim();
  if (!r || r.length < 3) throw new DisciplineError("Give a reason for removing the strike.", 400);
  return prisma.$transaction(async (tx) => {
    const u = await tx.boosterStrike.updateMany({
      where: { id: strikeId, removedAt: null },
      data: { removedAt: new Date(), removedById: adminId, removeReason: r.slice(0, 500) },
    });
    if (u.count === 0) throw new DisciplineError("Strike not found or already removed.", 404);
    await writeAudit(tx, { actorId: adminId, action: "STRIKE_REMOVED", entityType: "boosterStrike", entityId: strikeId, details: { reason: r } });
    return { removed: true };
  });
}

export async function strikeSummary(boosterId: string, now = new Date()) {
  const since = new Date(now.getTime() - STRIKE_WINDOW_DAYS * 86_400_000);
  const strikes = await prisma.boosterStrike.findMany({
    where: { boosterId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const active = strikes.filter((s) => !s.removedAt);
  return { last30Days: active.filter((s) => s.createdAt >= since).length, total: active.length, strikes };
}

/* ------------------------------------------------------------------ */
/* Fines                                                               */
/* ------------------------------------------------------------------ */

export async function getFineSchedule() {
  return getConfig("fine_schedule");
}

export async function issueFine(
  adminId: string,
  input: { boosterId: string; orderId: string; code: string; amount?: number | null; note: string }
) {
  await assertAdmin(adminId);
  const note = input.note?.trim();
  if (!note || note.length < 5) throw new DisciplineError("Explain the fine in a note (shown to the booster).", 400);
  const schedule = await getFineSchedule();
  const rule = schedule.find((r) => r.code === input.code);
  if (!rule) throw new DisciplineError("Unknown fine type.", 400);
  const amount = input.amount ?? rule.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) throw new DisciplineError("Enter a fine amount above zero.", 400);

  const worked = await prisma.orderBoosterAssignment.findFirst({ where: { orderId: input.orderId, boosterId: input.boosterId }, select: { id: true } });
  if (!worked) throw new DisciplineError("This booster never worked on that order.", 400);
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { pricingSnapshot: { select: { currency: true } }, currency: true } });
  const currency = order?.pricingSnapshot?.currency ?? order?.currency ?? "EUR";

  const { fine, strike } = await prisma.$transaction(async (tx) => {
    const fine = await tx.boosterFine.create({
      data: { boosterId: input.boosterId, orderId: input.orderId, code: rule.code, amount, currency, note: note.slice(0, 1000), issuedById: adminId },
    });
    await postLedger(tx, [
      {
        type: "BOOSTER_FINE", account: "BOOSTER_PAYABLE", amount: -amount, currency, idempotencyKey: `fine:${fine.id}:payable`,
        boosterId: input.boosterId, orderId: input.orderId, createdById: adminId, description: `Fine: ${rule.label}`,
      },
      {
        type: "BOOSTER_FINE", account: "PLATFORM_REVENUE", amount, currency, idempotencyKey: `fine:${fine.id}:platform`,
        boosterId: input.boosterId, orderId: input.orderId, createdById: adminId, description: `Fine: ${rule.label}`,
      },
    ]);
    const strike = await addStrike(tx, { boosterId: input.boosterId, orderId: input.orderId, code: "FINE", note: rule.label, createdById: adminId, fineId: fine.id });
    await writeAudit(tx, { actorId: adminId, action: "FINE_ISSUED", entityType: "boosterFine", entityId: fine.id, details: { code: rule.code, amount, currency, orderId: input.orderId } });
    return { fine, strike };
  });
  await notify(input.boosterId, "FINE_ISSUED", input.orderId, { amount: formatMoney(amount, currency), reason: `${rule.label}. ${note}` }, adminId, `fine:${fine.id}`);
  void strike;
  return fine;
}

export async function appealFine(boosterId: string, fineId: string, text: string) {
  const t = text?.trim();
  if (!t || t.length < 10) throw new DisciplineError("Explain your appeal (at least 10 characters).", 400);
  const u = await prisma.boosterFine.updateMany({
    where: { id: fineId, boosterId, status: "ISSUED", appealedAt: null },
    data: { status: "APPEALED", appealText: t.slice(0, 2000), appealedAt: new Date() },
  });
  if (u.count === 0) throw new DisciplineError("This fine cannot be appealed (already appealed or decided).", 409);
  const fine = await prisma.boosterFine.findUniqueOrThrow({ where: { id: fineId }, select: { orderId: true } });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      createNotification(a.id, "FINANCE_ALERT", fine.orderId, { reason: "a booster appealed a fine" }, boosterId, { dedupeKey: `fine-appeal:${fineId}` }).catch(() => {})
    )
  );
  return { appealed: true };
}

/** Opposite ledger entry, strike removed, deducted amount returned if already paid out. */
async function reverseFineTx(tx: Tx, fine: { id: string; boosterId: string; orderId: string; amount: number; currency: string; deductedPayoutId: string | null }, adminId: string, note: string) {
  if (fine.deductedPayoutId) {
    const payout = await tx.boosterPayout.findUnique({ where: { id: fine.deductedPayoutId }, select: { status: true } });
    if (payout && payout.status !== "PAID") {
      throw new DisciplineError("This fine is part of an open payout. Decide the payout first, then reverse the fine.", 409);
    }
  }
  await postLedger(tx, [
    {
      type: "BOOSTER_FINE_REVERSAL", account: "BOOSTER_PAYABLE", amount: fine.amount, currency: fine.currency, idempotencyKey: `fine:${fine.id}:reversal:payable`,
      boosterId: fine.boosterId, orderId: fine.orderId, createdById: adminId, description: "Fine reversed",
    },
    {
      type: "BOOSTER_FINE_REVERSAL", account: "PLATFORM_REVENUE", amount: -fine.amount, currency: fine.currency, idempotencyKey: `fine:${fine.id}:reversal:platform`,
      boosterId: fine.boosterId, orderId: fine.orderId, createdById: adminId, description: "Fine reversed",
    },
  ]);
  // Already taken off a paid payout: give it back through the next payout.
  if (fine.deductedPayoutId) {
    await tx.boosterEarning.create({
      data: {
        orderId: fine.orderId,
        boosterId: fine.boosterId,
        grossAmount: fine.amount,
        currency: fine.currency,
        platformFeeBps: 0,
        boosterShareBps: 10_000,
        status: "AVAILABLE",
        approvedAt: new Date(),
        approvedById: adminId,
        releasedAt: new Date(),
        allocationNote: `Fine refunded: ${note}`.slice(0, 500),
      },
    });
  }
  await tx.boosterStrike.updateMany({ where: { fineId: fine.id, removedAt: null }, data: { removedAt: new Date(), removedById: adminId, removeReason: "Fine reversed" } });
}

export async function decideFineAppeal(adminId: string, fineId: string, accept: boolean, note: string) {
  await assertAdmin(adminId);
  const n = note?.trim();
  if (!n || n.length < 3) throw new DisciplineError("A decision note is required.", 400);
  const fine = await prisma.$transaction(async (tx) => {
    const fine = await tx.boosterFine.findUnique({ where: { id: fineId } });
    if (!fine || fine.status !== "APPEALED") throw new DisciplineError("There is no open appeal on this fine.", 409);
    if (accept) await reverseFineTx(tx, fine, adminId, n);
    const u = await tx.boosterFine.updateMany({
      where: { id: fineId, status: "APPEALED" },
      data: accept
        ? { status: "REVERSED", reversedAt: new Date(), decidedAt: new Date(), decidedById: adminId, decisionNote: n.slice(0, 1000) }
        : { status: "UPHELD", decidedAt: new Date(), decidedById: adminId, decisionNote: n.slice(0, 1000) },
    });
    if (u.count === 0) throw new DisciplineError("The appeal was decided in the meantime.", 409);
    await writeAudit(tx, { actorId: adminId, action: accept ? "FINE_APPEAL_ACCEPTED" : "FINE_APPEAL_REJECTED", entityType: "boosterFine", entityId: fineId, details: { note: n } });
    return fine;
  });
  await notify(fine.boosterId, "FINE_APPEAL_DECIDED", fine.orderId, { accepted: accept }, adminId, `fine-decision:${fineId}`);
  return { status: accept ? "REVERSED" : "UPHELD" };
}

/** Admin cancels a fine without an appeal (e.g. issued by mistake). */
export async function reverseFine(adminId: string, fineId: string, note: string) {
  await assertAdmin(adminId);
  const n = note?.trim();
  if (!n || n.length < 3) throw new DisciplineError("A note is required.", 400);
  await prisma.$transaction(async (tx) => {
    const fine = await tx.boosterFine.findUnique({ where: { id: fineId } });
    if (!fine || fine.status === "REVERSED") throw new DisciplineError("Fine not found or already reversed.", 409);
    await reverseFineTx(tx, fine, adminId, n);
    const u = await tx.boosterFine.updateMany({
      where: { id: fineId, status: fine.status },
      data: { status: "REVERSED", reversedAt: new Date(), decidedAt: new Date(), decidedById: adminId, decisionNote: n.slice(0, 1000) },
    });
    if (u.count === 0) throw new DisciplineError("The fine changed in the meantime.", 409);
    await writeAudit(tx, { actorId: adminId, action: "FINE_REVERSED", entityType: "boosterFine", entityId: fineId, details: { note: n } });
  });
  return { status: "REVERSED" };
}

/** Fines to take off the booster's next payout: issued or upheld, not yet deducted. Appealed fines wait for the decision. */
export function finesDueForPayout(tx: Tx, boosterId: string, currency: string) {
  return tx.boosterFine.findMany({
    where: { boosterId, currency, status: { in: ["ISSUED", "UPHELD"] }, deductedPayoutId: null },
    select: { id: true, amount: true },
  });
}
