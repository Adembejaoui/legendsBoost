// Server-only module.
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { logger } from "@/lib/logger";

/**
 * General audit trail: `audit(actor, action, entity, payload)`.
 * For admin, security and operational actions (config changes, booster
 * decisions, forced releases, credential access...). Money actions keep
 * their dedicated FinancialAuditLog.
 *
 *  - Inside a transaction (pass `tx`): written with the change, and a failure
 *    rolls the change back (the action must not happen unaudited).
 *  - Without `tx`: best effort; a failure is logged, never thrown.
 * Never put secrets or personal data (passwords, emails, IPs of others) in
 * `metadata`.
 */
export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

type Db = Pick<Prisma.TransactionClient, "auditLog">;

export async function audit(entry: AuditEntry, tx?: Db): Promise<void> {
  const data = {
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    ip: entry.ip ?? null,
  };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await prisma.auditLog.create({ data });
  } catch (e) {
    logger.error("Audit log write failed", { action: entry.action, error: e instanceof Error ? e.name : "unknown" });
  }
}
