import type { Prisma } from "@/app/generated/prisma/client";

/** Append-only audit entry for an administrative financial action. */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: { actorId: string | null; action: string; entityType: string; entityId: string; details?: unknown }
) {
  await tx.financialAuditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
