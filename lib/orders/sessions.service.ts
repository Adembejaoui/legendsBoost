// Server-only module.
/**
 * Booster play sessions (Phase 4, decision 2026-11-15: required to reveal
 * the customer login).
 *
 * The booster starts a session and accepts the session rules; the customer
 * is told not to log in meanwhile. The login can be revealed only during an
 * open session, and every reveal is logged with the session and IP. A
 * session ends when the booster ends it, the customer pauses, the order is
 * completed / released, or after SESSION_MAX_HOURS. Phase 5 uses session
 * windows to attribute games to the booster.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { createNotification } from "@/lib/notifications/service";
import { logger } from "@/lib/logger";
import { signalOrder } from "@/lib/realtime/live";

export const SESSION_RULES_VERSION = "2026-11-15";
export const SESSION_MAX_HOURS = 12;

/** Shown to the booster when starting a session; accepting them is logged. */
export const SESSION_RULES = [
  "I play only on this order and only during this session.",
  "I respect the customer's requests (roles, champions, offline mode, no chat with other players).",
  "I never change the account email, password, name or settings, and never spend the customer's currency.",
  "I do not share the login with anyone and log out when the session ends.",
  "I stop immediately if the customer pauses the order.",
] as const;

type Db = Prisma.TransactionClient | typeof prisma;

export class SessionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "SessionError";
  }
}

/** Open, not expired session of the booster holding the order while it is in progress. */
export async function getOpenSession(orderId: string, boosterId: string, db: Db = prisma, now = new Date()) {
  const session = await db.orderSession.findFirst({
    where: {
      orderId,
      boosterId,
      endedAt: null,
      startedAt: { gt: new Date(now.getTime() - SESSION_MAX_HOURS * 3_600_000) },
    },
    orderBy: { startedAt: "desc" },
  });
  if (!session) return null;
  const assignment = await db.orderBoosterAssignment.findFirst({
    where: { id: session.assignmentId, boosterId, activeOrderId: orderId, status: "IN_PROGRESS" },
    select: { id: true, order: { select: { status: true } } },
  });
  return assignment && assignment.order.status === "IN_PROGRESS" ? session : null;
}

export async function startSession(
  orderId: string,
  boosterId: string,
  input: { rulesAccepted: boolean; ip?: string | null; userAgent?: string | null }
) {
  if (input.rulesAccepted !== true) throw new SessionError("Accept the session rules to start.", 400);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const assignment = await tx.orderBoosterAssignment.findFirst({
      where: { orderId, boosterId, activeOrderId: orderId, status: "IN_PROGRESS" },
      select: { id: true, order: { select: { status: true, userId: true } } },
    });
    if (!assignment || assignment.order.status !== "IN_PROGRESS") {
      throw new SessionError("Sessions can only be started on an order you are working on (started and not paused).", 409);
    }
    // Close an expired leftover so the one-open-session index allows a new one.
    await tx.orderSession.updateMany({
      where: { assignmentId: assignment.id, endedAt: null, startedAt: { lte: new Date(now.getTime() - SESSION_MAX_HOURS * 3_600_000) } },
      data: { endedAt: now, endReason: "EXPIRED" },
    });
    const open = await tx.orderSession.findFirst({ where: { assignmentId: assignment.id, endedAt: null } });
    if (open) return { session: open, created: false, customerId: assignment.order.userId };
    const session = await tx.orderSession.create({
      data: {
        orderId,
        assignmentId: assignment.id,
        boosterId,
        rulesVersion: SESSION_RULES_VERSION,
        ip: input.ip?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
    await tx.orderEvent.create({
      data: { orderId, type: "SESSION_STARTED", message: "Booster started a session", metadata: { sessionId: session.id, rulesVersion: SESSION_RULES_VERSION } },
    });
    return { session, created: true, customerId: assignment.order.userId };
  });
  if (result.created) {
    await signalOrder(orderId, "session");
    await createNotification(result.customerId, "SESSION_STARTED", orderId, undefined, boosterId, { dedupeKey: `session-started:${result.session.id}` }).catch((e) =>
      logger.warn("Session notification failed", { error: e instanceof Error ? e.message : "unknown" })
    );
  }
  return result.session;
}

export async function endSession(orderId: string, boosterId: string) {
  const now = new Date();
  const r = await prisma.orderSession.updateMany({ where: { orderId, boosterId, endedAt: null }, data: { endedAt: now, endReason: "BOOSTER" } });
  if (r.count > 0) {
    await prisma.orderEvent.create({ data: { orderId, type: "SESSION_ENDED", message: "Booster ended the session", metadata: { reason: "BOOSTER" } } });
    await signalOrder(orderId, "session");
  }
  return { ended: r.count > 0 };
}

/** End every open session of the order (pause, completion, release...). */
export async function endOpenSessions(db: Db, orderId: string, reason: "PAUSED" | "COMPLETED" | "RELEASED" | "CANCELLED") {
  return db.orderSession.updateMany({ where: { orderId, endedAt: null }, data: { endedAt: new Date(), endReason: reason } });
}

export interface SessionDTO {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export async function listSessions(orderId: string, take = 20): Promise<SessionDTO[]> {
  const rows = await prisma.orderSession.findMany({
    where: { orderId },
    orderBy: { startedAt: "desc" },
    take,
    select: { id: true, startedAt: true, endedAt: true, endReason: true },
  });
  return rows.map((r) => ({ id: r.id, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null, endReason: r.endReason }));
}

/** Client IP for logs (first X-Forwarded-For entry, else X-Real-IP). */
export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64) || null;
  return headers.get("x-real-ip")?.trim().slice(0, 64) || null;
}
