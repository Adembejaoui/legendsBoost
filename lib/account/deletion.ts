// Server-only module.
/**
 * Account deletion (Phase 9, GDPR; decision 2026-11-17: request, admin
 * approves, personal data anonymised).
 *
 *  - Customers and boosters request it from their profile (with an optional
 *    reason). Refused while something is still running: an active order, an
 *    order being worked on, an open payout, or earnings not paid out yet.
 *  - An admin approves (the account is anonymised) or rejects with a note.
 *  - Anonymised: name, email, picture, password, sign-in links and sessions,
 *    booster application, bio, public name and payout details, account
 *    logins, Riot IDs and cached Riot profiles of their orders,
 *    notifications. Kept, without a name or email: orders, payments, ledger,
 *    earnings and payouts (accounting obligation), messages and reviews
 *    (shown as "Deleted user").
 */
import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { audit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/assignments/types";

export class AccountDeletionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/** What still prevents deleting this account (empty = nothing). */
export async function deletionBlockers(userId: string, db: Db = prisma): Promise<string[]> {
  const [activeOrders, activeWork, openPayouts, unpaid] = await Promise.all([
    db.order.count({ where: { userId, status: { in: ["PENDING", "CLAIMED", "IN_PROGRESS", "PAUSED", "AWAITING_CONFIRMATION", "DRAFT"] } } }),
    db.orderBoosterAssignment.count({ where: { boosterId: userId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } }),
    db.boosterPayout.count({ where: { boosterId: userId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } }),
    db.boosterEarning.count({ where: { boosterId: userId, status: { in: ["PENDING", "AVAILABLE", "ON_HOLD", "IN_PAYOUT"] } } }),
  ]);
  const out: string[] = [];
  if (activeOrders) out.push("You have an order that is not finished yet.");
  if (activeWork) out.push("You are still working on an order.");
  if (openPayouts) out.push("You have a payout in progress.");
  if (unpaid) out.push("You have earnings that are not paid out yet: request a payout first.");
  return out;
}

export async function requestAccountDeletion(userId: string, reason?: string | null) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new AccountDeletionError("Account not found.", 404);
  if (user.role === "ADMIN") throw new AccountDeletionError("Admin accounts are removed by another admin, not through this form.", 403);
  const pending = await prisma.accountDeletionRequest.findFirst({ where: { userId, status: "REQUESTED" }, select: { id: true } });
  if (pending) throw new AccountDeletionError("You already asked to delete your account.", 409);
  const blockers = await deletionBlockers(userId);
  if (blockers.length) throw new AccountDeletionError(blockers.join(" "), 409);
  let request;
  try {
    request = await prisma.accountDeletionRequest.create({ data: { userId, reason: reason?.trim().slice(0, 500) || null } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AccountDeletionError("You already asked to delete your account.", 409);
    throw e;
  }
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", deletedAt: null }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      createNotification(a.id, "ACCOUNT_DELETION_REQUESTED", undefined, {}, userId, { dedupeKey: `deletion:${request.id}` }).catch(() => {})
    )
  );
  return request;
}

export async function cancelAccountDeletion(userId: string) {
  const r = await prisma.accountDeletionRequest.updateMany({ where: { userId, status: "REQUESTED" }, data: { status: "CANCELLED", decidedAt: new Date() } });
  if (r.count === 0) throw new AccountDeletionError("You have no pending deletion request.", 404);
  return { cancelled: true };
}

/** Remove personal data; keep the records the business must keep. */
export async function anonymizeUser(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  await tx.user.update({
    where: { id: userId },
    data: { name: "Deleted user", email: `deleted-${userId}@deleted.invalid`, image: null, passwordHash: null, emailVerified: null, deletedAt: now },
  });
  await tx.account.deleteMany({ where: { userId } });
  await tx.session.deleteMany({ where: { userId } });
  await tx.boosterProfile.updateMany({
    where: { userId },
    data: { displayName: null, biography: null, applicationData: Prisma.DbNull, specializations: Prisma.DbNull, kycReference: null, reviewNote: null },
  });
  await tx.boosterPayoutMethod.deleteMany({ where: { boosterId: userId } });
  await tx.orderAccountCredential.deleteMany({ where: { order: { userId } } });
  await tx.orderRiotAccount.updateMany({
    where: { order: { userId } },
    data: { gameName: "deleted", tagLine: "deleted", puuid: null, profile: Prisma.DbNull, pendingMatchIds: [] },
  });
  await tx.notification.deleteMany({ where: { userId } });
}

export async function decideAccountDeletion(adminId: string, requestId: string, approve: boolean, note?: string | null) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  if (!admin || admin.role !== "ADMIN") throw new AccountDeletionError("Only administrators can do this.", 403);
  const n = note?.trim() || null;
  if (!approve && (!n || n.length < 3)) throw new AccountDeletionError("Explain why the request is rejected.", 400);
  return prisma.$transaction(async (tx) => {
    const req = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status !== "REQUESTED") throw new AccountDeletionError("This request is not pending.", 409);
    if (approve) {
      const blockers = await deletionBlockers(req.userId, tx);
      if (blockers.length) throw new AccountDeletionError(`Not yet: ${blockers.join(" ")}`, 409);
      await anonymizeUser(tx, req.userId);
    }
    await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedById: adminId, decisionNote: n },
    });
    await audit({ actorId: adminId, action: approve ? "ACCOUNT_DELETED" : "ACCOUNT_DELETION_REJECTED", entityType: "user", entityId: req.userId, metadata: { requestId } }, tx);
    return { status: approve ? "APPROVED" : "REJECTED" };
  });
}
