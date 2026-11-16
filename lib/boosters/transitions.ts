// Server-only module.
/**
 * The ONLY way to change BoosterProfile.verificationStatus (build plan rule
 * 4, `transitionBooster`). A table says which moves are legal and who may
 * make them; every change is a conditional write (a concurrent change makes
 * it fail instead of being overwritten), a BoosterEvent and an audit row.
 *
 *   applicant: PENDING -> UNDER_REVIEW -> (NEEDS_INFO <-> PENDING) -> TRIAL | APPROVED | REJECTED
 *   booster:   TRIAL -> APPROVED;  APPROVED <-> ON_BREAK;  -> SUSPENDED -> APPROVED | TERMINATED
 *   REJECTED -> PENDING (re-apply);  TERMINATED is final.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { audit } from "@/lib/audit";
import { getConfigIn } from "@/lib/config";
import type { BoosterStatus } from "./status";
import { ensureDefaultPermissions } from "./permissions";

type Actor = "admin" | "self";

/** from -> { to: who may do it }. */
export const BOOSTER_TRANSITIONS: Record<BoosterStatus, Partial<Record<BoosterStatus, readonly Actor[]>>> = {
  PENDING: { UNDER_REVIEW: ["admin"], NEEDS_INFO: ["admin"], TRIAL: ["admin"], APPROVED: ["admin"], REJECTED: ["admin"] },
  UNDER_REVIEW: { NEEDS_INFO: ["admin"], TRIAL: ["admin"], APPROVED: ["admin"], REJECTED: ["admin"] },
  // The applicant answers by resubmitting the application.
  NEEDS_INFO: { PENDING: ["self"], REJECTED: ["admin"] },
  REJECTED: { PENDING: ["self"] },
  TRIAL: { APPROVED: ["admin"], SUSPENDED: ["admin"], TERMINATED: ["admin"], REJECTED: ["admin"] },
  APPROVED: { ON_BREAK: ["self", "admin"], SUSPENDED: ["admin"], TERMINATED: ["admin"] },
  ON_BREAK: { APPROVED: ["self", "admin"], SUSPENDED: ["admin"], TERMINATED: ["admin"] },
  SUSPENDED: { APPROVED: ["admin"], TERMINATED: ["admin"] },
  TERMINATED: {},
};

export class BoosterTransitionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BoosterTransitionError";
  }
}

export function canTransitionBooster(from: BoosterStatus, to: BoosterStatus, actor: Actor): boolean {
  return BOOSTER_TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

/** Moves that require a note (shown to the booster or kept for the record). */
const NOTE_REQUIRED: readonly BoosterStatus[] = ["NEEDS_INFO", "REJECTED", "SUSPENDED", "TERMINATED"];

type Tx = Prisma.TransactionClient;

export async function transitionBooster(
  tx: Tx,
  args: { profileId: string; to: BoosterStatus; actorId: string; actor: Actor; note?: string | null; expectedFrom?: BoosterStatus }
) {
  const profile = await tx.boosterProfile.findUnique({
    where: { id: args.profileId },
    select: { id: true, userId: true, verificationStatus: true, approvedAt: true, applicationData: true },
  });
  if (!profile) throw new BoosterTransitionError("Booster not found", 404);
  const from = profile.verificationStatus as BoosterStatus;
  if (args.expectedFrom && from !== args.expectedFrom) {
    throw new BoosterTransitionError("This booster's status changed in the meantime. Reload and try again.", 409);
  }
  if (!canTransitionBooster(from, args.to, args.actor)) {
    throw new BoosterTransitionError(`Not allowed: ${from} -> ${args.to}`, from === args.to ? 409 : 403);
  }
  const note = args.note?.trim() || null;
  if (NOTE_REQUIRED.includes(args.to) && args.actor === "admin" && !note) {
    throw new BoosterTransitionError("A note is required for this change.", 400);
  }

  const now = new Date();
  const data: Prisma.BoosterProfileUpdateInput = { verificationStatus: args.to };
  if (args.actor === "admin") Object.assign(data, { reviewedAt: now, reviewer: { connect: { id: args.actorId } } });
  if (args.to === "NEEDS_INFO") data.reviewNote = note;
  if (args.to === "REJECTED") data.rejectionReason = note;
  if (args.to === "PENDING") Object.assign(data, { reviewNote: null, rejectionReason: null });
  if (args.to === "TRIAL") Object.assign(data, { trialOrdersRemaining: await getConfigIn(tx, "booster_trial_orders"), approvedAt: profile.approvedAt ?? now, rejectionReason: null, reviewNote: null });
  if (args.to === "APPROVED") Object.assign(data, { trialOrdersRemaining: null, approvedAt: profile.approvedAt ?? now, rejectionReason: null, reviewNote: null });

  // Conditional on the status read above: a concurrent change fails (P2025).
  const updated = await tx.boosterProfile.update({ where: { id: profile.id, verificationStatus: from }, data });

  // Becoming a booster (trial or active) gives the BOOSTER role and default
  // per-game permissions (rank ceiling = application peak rank).
  if (args.to === "TRIAL" || (args.to === "APPROVED" && (from === "PENDING" || from === "UNDER_REVIEW"))) {
    await tx.user.update({ where: { id: profile.userId }, data: { role: "BOOSTER" } });
    await ensureDefaultPermissions(tx, profile.id, profile.applicationData, args.actorId);
  }

  await tx.boosterEvent.create({
    data: { boosterProfileId: profile.id, type: "STATUS_CHANGED", fromStatus: from, toStatus: args.to, actorId: args.actorId, note },
  });
  await audit(
    { actorId: args.actorId, action: "BOOSTER_STATUS_CHANGED", entityType: "boosterProfile", entityId: profile.id, metadata: { from, to: args.to, by: args.actor } },
    tx
  );
  return updated;
}
