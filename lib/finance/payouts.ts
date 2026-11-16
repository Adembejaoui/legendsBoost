/**
 * Manual booster payouts (no Stripe Connect).
 *
 *   booster requests  -> REQUESTED   (all AVAILABLE earnings of one currency
 *                                     move to IN_PAYOUT atomically)
 *   admin approves    -> APPROVED
 *   admin processing  -> PROCESSING  (optional step)
 *   admin records paid-> PAID        (method + external reference + evidence
 *                                     required; ledger BOOSTER_PAYABLE ->
 *                                     BOOSTER_PAYOUTS; earnings PAID)
 *   admin rejects     -> REJECTED    (reason; earnings back to AVAILABLE)
 *   admin marks failed-> FAILED      (from PROCESSING; earnings back)
 *
 * Duplicate prevention: one open payout per booster and currency (openKey
 * unique); an earning joins a payout only via a conditional AVAILABLE ->
 * IN_PAYOUT update; (method, externalReference) is unique; the PAID ledger
 * posting has a fixed idempotency key. No balance is ever edited directly.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { normalizeCurrency } from "@/lib/money";
import { accountBalance, postLedger } from "./ledger";
import { writeAudit } from "./audit";
import { enqueueOutbox, dispatchOutbox } from "@/lib/payments/outbox";
import { hasBoosterAccess } from "@/lib/boosters/status";
import { finesDueForPayout } from "@/lib/boosters/discipline";
import { PayoutMethodError, payoutMethodSnapshot } from "./payout-methods";

export class PayoutError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PayoutError";
  }
}

type Tx = Prisma.TransactionClient;

function notifyBooster(payout: { id: string; boosterId: string }, status: string, actorId: string) {
  return {
    type: "NOTIFY" as const,
    dedupeKey: `payout:${payout.id}:${status}`,
    payload: { notification: "PAYOUT_UPDATED" as const, recipients: [payout.boosterId], orderId: null, actorId, metadata: { newStatus: status, payoutId: payout.id } },
  };
}

export async function requestPayout(boosterId: string, currencyInput: string) {
  const user = await prisma.user.findUnique({ where: { id: boosterId }, include: { boosterProfile: { select: { verificationStatus: true, kycStatus: true } } } });
  if (!user || user.role !== "BOOSTER" || !hasBoosterAccess(user.boosterProfile?.verificationStatus)) {
    throw new PayoutError("Only approved boosters can request payouts.", 403);
  }
  // Phase 7 (decision 2026-11-16): verified identity and a saved payout method.
  if (user.boosterProfile?.kycStatus !== "VERIFIED") {
    throw new PayoutError("Verify your identity (Profile, Identity verification) before requesting a payout.", 403);
  }
  let method: Awaited<ReturnType<typeof payoutMethodSnapshot>>;
  try {
    method = await payoutMethodSnapshot(boosterId);
  } catch (e) {
    if (e instanceof PayoutMethodError) throw new PayoutError(e.message, e.status);
    throw e;
  }
  let currency: string;
  try {
    currency = normalizeCurrency(currencyInput);
  } catch {
    throw new PayoutError("Invalid currency.", 400);
  }

  try {
    const payout = await prisma.$transaction(async (tx) => {
      const earnings = await tx.boosterEarning.findMany({
        where: { boosterId, currency, status: "AVAILABLE", payoutId: null },
        select: { id: true, grossAmount: true, reversedAmount: true },
      });
      const earned = earnings.reduce((a, e) => a + (e.grossAmount - e.reversedAmount), 0);
      if (earned <= 0) throw new PayoutError("No available earnings to pay out.", 409);
      // Unpaid fines are taken off this payout (Phase 6).
      const fines = await finesDueForPayout(tx, boosterId, currency);
      const finesDeducted = fines.reduce((a, x) => a + x.amount, 0);
      const amount = earned - finesDeducted;
      if (amount <= 0) {
        throw new PayoutError("Your unpaid fines are equal to or more than your available earnings. Earn more or appeal a fine first.", 409);
      }
      // Reversals on already paid earnings leave a negative ledger balance;
      // it must be settled before more money is paid out.
      const balance = await accountBalance("BOOSTER_PAYABLE", { boosterId, currency }, tx);
      // Fines under appeal are already on the ledger but are only taken off a
      // payout once upheld; they do not block this one.
      const appealed = await tx.boosterFine.aggregate({
        where: { boosterId, currency, status: "APPEALED", deductedPayoutId: null },
        _sum: { amount: true },
      });
      if (balance + (appealed._sum.amount ?? 0) < amount) throw new PayoutError("An outstanding balance adjustment must be settled first. Contact support.", 409);

      const created = await tx.boosterPayout.create({
        data: { boosterId, amount, currency, status: "REQUESTED", openKey: `${boosterId}:${currency}`, finesDeducted, ...method },
      });
      if (fines.length > 0) {
        const taken = await tx.boosterFine.updateMany({
          where: { id: { in: fines.map((x) => x.id) }, deductedPayoutId: null, status: { in: ["ISSUED", "UPHELD"] } },
          data: { deductedPayoutId: created.id },
        });
        if (taken.count !== fines.length) throw new PayoutError("Your fines changed. Please try again.", 409);
      }
      const moved = await tx.boosterEarning.updateMany({
        where: { id: { in: earnings.map((e) => e.id) }, status: "AVAILABLE", payoutId: null },
        data: { status: "IN_PAYOUT", payoutId: created.id },
      });
      if (moved.count !== earnings.length) throw new PayoutError("Your earnings changed. Please try again.", 409);
      await writeAudit(tx, { actorId: boosterId, action: "PAYOUT_REQUESTED", entityType: "boosterPayout", entityId: created.id, details: { amount, currency, earnings: earnings.length, finesDeducted } });
      await enqueueOutbox(tx, [
        { type: "NOTIFY", dedupeKey: `payout:${created.id}:requested-admins`, payload: { notification: "FINANCE_ALERT", recipients: "ADMINS", orderId: null, actorId: boosterId, metadata: { reason: "a booster requested a payout", payoutId: created.id } } },
      ]);
      return created;
    });
    await dispatchOutbox({ limit: 5 });
    return payout;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new PayoutError("You already have an open payout request.", 409);
    throw e;
  }
}

async function assertAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u || u.role !== "ADMIN") throw new PayoutError("Only administrators can manage payouts.", 403);
}

async function transition(
  adminId: string,
  payoutId: string,
  from: ("REQUESTED" | "APPROVED" | "PROCESSING")[],
  apply: (tx: Tx, payout: { id: string; boosterId: string; amount: number; currency: string; status: string }) => Promise<Prisma.BoosterPayoutUpdateInput>,
  action: string,
  details?: unknown
) {
  await assertAdmin(adminId);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const payout = await tx.boosterPayout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new PayoutError("Payout not found.", 404);
      if (!from.includes(payout.status as never)) throw new PayoutError(`Payout is ${payout.status}.`, 409);
      const data = await apply(tx, payout);
      const updated = await tx.boosterPayout.update({ where: { id: payout.id, status: payout.status }, data });
      await writeAudit(tx, { actorId: adminId, action, entityType: "boosterPayout", entityId: payout.id, details: details ?? null });
      await enqueueOutbox(tx, [notifyBooster(updated, updated.status, adminId)]);
      return updated;
    });
    await dispatchOutbox({ limit: 5 });
    return result;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2025") throw new PayoutError("The payout changed in the meantime. Reload and try again.", 409);
    if (code === "P2002") throw new PayoutError("This external payment reference is already recorded for another payout.", 409);
    throw e;
  }
}

export function approvePayout(adminId: string, payoutId: string) {
  return transition(adminId, payoutId, ["REQUESTED"], async () => ({ status: "APPROVED", approvedAt: new Date(), approvedById: adminId }), "PAYOUT_APPROVED");
}

export function markPayoutProcessing(adminId: string, payoutId: string) {
  return transition(adminId, payoutId, ["APPROVED"], async () => ({ status: "PROCESSING", processingAt: new Date() }), "PAYOUT_PROCESSING");
}

export function recordPayoutPaid(
  adminId: string,
  payoutId: string,
  input: { method: string; externalReference: string; evidence: string; paidAt?: Date }
) {
  const method = input.method?.trim();
  const externalReference = input.externalReference?.trim();
  const evidence = input.evidence?.trim();
  const paidAt = input.paidAt ?? new Date();
  if (!method || !externalReference || !evidence || evidence.length < 3) {
    return Promise.reject(new PayoutError("Payment method, external reference and evidence are required.", 400));
  }
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000) {
    return Promise.reject(new PayoutError("The payment date cannot be in the future.", 400));
  }
  return transition(
    adminId,
    payoutId,
    ["APPROVED", "PROCESSING"],
    async (tx, payout) => {
      const items = await tx.boosterEarning.findMany({ where: { payoutId: payout.id, status: "IN_PAYOUT" }, select: { id: true, grossAmount: true, reversedAmount: true } });
      const marked = await tx.boosterEarning.updateMany({ where: { payoutId: payout.id, status: "IN_PAYOUT" }, data: { status: "PAID", paidAt } });
      if (marked.count !== items.length || items.length === 0) throw new PayoutError("Payout items changed. Reload and try again.", 409);
      await postLedger(tx, [
        {
          type: "BOOSTER_PAYOUT", account: "BOOSTER_PAYABLE", amount: -payout.amount, currency: payout.currency,
          idempotencyKey: `payout:${payout.id}:paid:payable`, boosterId: payout.boosterId, payoutId: payout.id, createdById: adminId,
          description: `Manual payout via ${method} (${externalReference})`,
        },
        {
          type: "BOOSTER_PAYOUT", account: "BOOSTER_PAYOUTS", amount: payout.amount, currency: payout.currency,
          idempotencyKey: `payout:${payout.id}:paid:payouts`, boosterId: payout.boosterId, payoutId: payout.id, createdById: adminId,
        },
      ]);
      return { status: "PAID", method, externalReference, evidence, paidAt, paidRecordedById: adminId, openKey: null };
    },
    "PAYOUT_PAID",
    { method, externalReference, evidence, paidAt: paidAt.toISOString() }
  );
}

async function releaseItems(tx: Tx, payoutId: string) {
  await tx.boosterEarning.updateMany({ where: { payoutId, status: "IN_PAYOUT" }, data: { status: "AVAILABLE", payoutId: null } });
  // Fines taken off this payout are due again on the next one.
  await tx.boosterFine.updateMany({ where: { deductedPayoutId: payoutId }, data: { deductedPayoutId: null } });
}

export function rejectPayout(adminId: string, payoutId: string, reason: string) {
  const r = reason?.trim();
  if (!r || r.length < 3) return Promise.reject(new PayoutError("A rejection reason is required.", 400));
  return transition(
    adminId,
    payoutId,
    ["REQUESTED", "APPROVED"],
    async (tx, payout) => {
      await releaseItems(tx, payout.id);
      return { status: "REJECTED", rejectedAt: new Date(), rejectedById: adminId, rejectionReason: r.slice(0, 500), openKey: null };
    },
    "PAYOUT_REJECTED",
    { reason: r }
  );
}

export function markPayoutFailed(adminId: string, payoutId: string, reason: string) {
  const r = reason?.trim();
  if (!r || r.length < 3) return Promise.reject(new PayoutError("A failure reason is required.", 400));
  return transition(
    adminId,
    payoutId,
    ["PROCESSING"],
    async (tx, payout) => {
      await releaseItems(tx, payout.id);
      return { status: "FAILED", failedAt: new Date(), failureReason: r.slice(0, 500), openKey: null };
    },
    "PAYOUT_FAILED",
    { reason: r }
  );
}
