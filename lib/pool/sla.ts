// Server-only module.
/**
 * SLA v1 after an order is taken (decision 2026-11-15: warnings only, no
 * automatic release; strikes and fines come in Phase 6).
 *
 *   contact: the booster has not sent a chat message within
 *            `contact_sla_min` (5) of taking the order -> booster warned.
 *   start:   the order is still CLAIMED after `start_sla_min` (60) ->
 *            booster and admins warned.
 *
 * Each warning is sent once per assignment (contactWarnedAt / startWarnedAt,
 * set with a conditional update so two runs never warn twice).
 */
import prisma from "@/lib/prisma";
import { getConfig } from "@/lib/config";
import { createNotification } from "@/lib/notifications/service";
import { logger } from "@/lib/logger";
import { addStrike, notifyStrike } from "@/lib/boosters/discipline";

export async function runSlaWarnings(now = new Date(), limit = 100) {
  const [contactMin, startMin] = await Promise.all([getConfig("contact_sla_min"), getConfig("start_sla_min")]);
  let contact = 0;
  let start = 0;

  // Contact: no message from the booster since the order was taken.
  const contactDue = await prisma.orderBoosterAssignment.findMany({
    where: {
      status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] },
      contactWarnedAt: null,
      awardMode: { not: null },
      assignedAt: { lte: new Date(now.getTime() - contactMin * 60_000) },
    },
    select: { id: true, orderId: true, boosterId: true, assignedAt: true },
    take: limit,
  });
  for (const a of contactDue) {
    const sent = await prisma.orderMessage.count({
      where: { senderId: a.boosterId, conversation: { orderId: a.orderId }, createdAt: { gte: a.assignedAt } },
    });
    const marked = await prisma.orderBoosterAssignment.updateMany({ where: { id: a.id, contactWarnedAt: null }, data: { contactWarnedAt: now } });
    if (marked.count === 0 || sent > 0) continue; // already handled, or contact made (marked so it is not checked again)
    await createNotification(a.boosterId, "SLA_WARNING", a.orderId, { kind: "contact" }, "system", { dedupeKey: `sla-contact:${a.id}` }).catch((e) =>
      logger.warn("SLA contact warning failed", { error: e instanceof Error ? e.message : "unknown" })
    );
    contact++;
  }

  // Start: still not started.
  const startDue = await prisma.orderBoosterAssignment.findMany({
    where: {
      status: { in: ["ASSIGNED", "ACCEPTED"] },
      startWarnedAt: null,
      order: { status: "CLAIMED" },
      assignedAt: { lte: new Date(now.getTime() - startMin * 60_000) },
    },
    select: { id: true, orderId: true, boosterId: true },
    take: limit,
  });
  if (startDue.length) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    for (const a of startDue) {
      const marked = await prisma.orderBoosterAssignment.updateMany({ where: { id: a.id, startWarnedAt: null }, data: { startWarnedAt: now } });
      if (marked.count === 0) continue;
      await Promise.all(
        [a.boosterId, ...admins.map((x) => x.id)].map((userId) =>
          createNotification(userId, "SLA_WARNING", a.orderId, { kind: "start" }, "system", { dedupeKey: `sla-start:${a.id}` }).catch(() => {})
        )
      );
      await prisma.orderEvent.create({ data: { orderId: a.orderId, type: "SLA_START_MISSED", message: "The booster has not started the order in time", metadata: { assignmentId: a.id } } });
      // Phase 6: a missed start is a strike (still no automatic release).
      const strike = await addStrike(prisma, { boosterId: a.boosterId, orderId: a.orderId, code: "SLA_START" });
      await notifyStrike(strike);
      start++;
    }
  }
  return { contactWarnings: contact, startWarnings: start };
}

/**
 * Inactivity (Phase 6, decision 2026-11-15): an in-progress order (not
 * paused) with no booster game, no booster message and no session start for
 * `inactivity_warn_hours` (12) -> warning to the booster and every admin.
 * No automatic release. Warned again only after new activity goes quiet again.
 */
export async function runInactivityWarnings(now = new Date(), limit = 100) {
  const hours = await getConfig("inactivity_warn_hours");
  const cutoff = new Date(now.getTime() - hours * 3_600_000);
  const candidates = await prisma.orderBoosterAssignment.findMany({
    where: { status: "IN_PROGRESS", order: { status: "IN_PROGRESS" }, startedAt: { lte: cutoff } },
    select: { id: true, orderId: true, boosterId: true, startedAt: true, inactivityWarnedAt: true },
    take: limit,
  });
  let warned = 0;
  let admins: { id: string }[] | null = null;
  for (const a of candidates) {
    const [lastGame, lastMessage, lastSession, lastResume] = await Promise.all([
      prisma.orderMatch.findFirst({ where: { orderId: a.orderId, playedBy: "BOOSTER" }, orderBy: { gameEndAt: "desc" }, select: { gameEndAt: true } }),
      prisma.orderMessage.findFirst({ where: { senderId: a.boosterId, conversation: { orderId: a.orderId } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.orderSession.findFirst({ where: { orderId: a.orderId, boosterId: a.boosterId }, orderBy: { startedAt: "desc" }, select: { startedAt: true, endedAt: true } }),
      prisma.orderEvent.findFirst({ where: { orderId: a.orderId, type: "ORDER_RESUMED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    // An open session counts as activity right now.
    const sessionActivity = lastSession ? (lastSession.endedAt ?? now) : null;
    const lastActivity = [a.startedAt, lastGame?.gameEndAt, lastMessage?.createdAt, sessionActivity, lastResume?.createdAt]
      .filter((d): d is Date => !!d)
      .reduce((m, d) => (d > m ? d : m), new Date(0));
    if (lastActivity > cutoff) continue;
    if (a.inactivityWarnedAt && a.inactivityWarnedAt >= lastActivity) continue; // already warned for this quiet spell
    const marked = await prisma.orderBoosterAssignment.updateMany({
      where: { id: a.id, inactivityWarnedAt: a.inactivityWarnedAt },
      data: { inactivityWarnedAt: now },
    });
    if (marked.count === 0) continue;
    admins ??= await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    const key = `inactivity:${a.id}:${now.toISOString().slice(0, 13)}`;
    await Promise.all(
      [a.boosterId, ...admins.map((x) => x.id)].map((userId) =>
        createNotification(userId, "INACTIVITY_WARNING", a.orderId, { hours }, "system", { dedupeKey: key }).catch(() => {})
      )
    );
    await prisma.orderEvent.create({
      data: { orderId: a.orderId, type: "INACTIVITY_WARNING", message: `No games and no messages for ${hours} hours`, metadata: { assignmentId: a.id, lastActivity: lastActivity.toISOString() } },
    });
    warned++;
  }
  return { inactivityWarnings: warned };
}
