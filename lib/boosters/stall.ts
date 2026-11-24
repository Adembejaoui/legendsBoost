// Server-only module.
/**
 * Stalled orders (client 2026-11-24). For every order a booster holds (taken
 * or in progress, not paused), measured from the booster's last activity:
 *
 *   45 min after the claim, no message to the customer -> in-app alert with
 *          sound (stall_contact_alert_min). Once per assignment.
 *   2 h without activity -> email + notification (stall_email_hours).
 *   1 h before the limit -> final warning, email + notification.
 *   24 h without activity -> the order is taken back and the booster fined
 *          (inactivity_release_hours; autoReleaseStalledAssignment): not
 *          started -> back to the pool, in progress -> draft for admin review.
 *
 * Activity = a message from the booster, a game the booster played, a rank /
 * games progress update, a play session (an open one counts as now), the
 * start of the order or the customer resuming it. A pause stops the clock
 * (paused orders are skipped; the resume restarts it).
 *
 * Every stage is marked with a conditional update before anything is sent,
 * so two job runs never warn or release twice. An order is only taken back
 * when its final warning went out at least 30 minutes earlier, even if the
 * job was down for a while.
 */
import prisma from "@/lib/prisma";
import { getConfig } from "@/lib/config";
import { createNotification } from "@/lib/notifications/service";
import { enqueueOutbox, dispatchOutbox } from "@/lib/payments/outbox";
import { logger } from "@/lib/logger";
import { autoReleaseStalledAssignment } from "@/lib/assignments/service";

const HOUR = 3_600_000;
/** The final warning must be this old before the order is taken back. */
export const FINAL_WARNING_MIN_LEAD_MS = 30 * 60_000;

const HELD = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] as const;

type Candidate = {
  id: string;
  orderId: string;
  boosterId: string;
  assignedAt: Date;
  startedAt: Date | null;
  stallSoundAlertedAt: Date | null;
  stallEmailedAt: Date | null;
  stallFinalWarnedAt: Date | null;
};

export interface StallSettings {
  contactMin: number;
  emailHours: number;
  releaseHours: number;
}

export async function stallSettings(): Promise<StallSettings> {
  const [contactMin, emailHours, releaseHours] = await Promise.all([
    getConfig("stall_contact_alert_min"),
    getConfig("stall_email_hours"),
    getConfig("inactivity_release_hours"),
  ]);
  return { contactMin, emailHours, releaseHours };
}

/** What the job should do for one assignment now (pure, tested on its own). */
export function stallStage(
  a: Pick<Candidate, "stallEmailedAt" | "stallFinalWarnedAt">,
  lastActivity: Date,
  now: Date,
  s: Pick<StallSettings, "emailHours" | "releaseHours">
): "release" | "final" | "email" | null {
  const idle = now.getTime() - lastActivity.getTime();
  const finalAt = Math.max(s.releaseHours - 1, s.emailHours) * HOUR;
  const warnedThisSpell = (d: Date | null) => !!d && d >= lastActivity;
  if (
    idle >= s.releaseHours * HOUR &&
    warnedThisSpell(a.stallFinalWarnedAt) &&
    now.getTime() - a.stallFinalWarnedAt!.getTime() >= FINAL_WARNING_MIN_LEAD_MS
  ) {
    return "release";
  }
  if (idle >= finalAt && s.releaseHours > s.emailHours && !warnedThisSpell(a.stallFinalWarnedAt)) return "final";
  if (idle >= s.emailHours * HOUR && !warnedThisSpell(a.stallEmailedAt)) return "email";
  return null;
}

/** Latest booster activity on the order since the assignment began. */
export async function lastBoosterActivity(a: Pick<Candidate, "orderId" | "boosterId" | "assignedAt" | "startedAt">, now: Date): Promise<Date> {
  const [lastGame, lastMessage, lastSession, lastResume, lastUpdate] = await Promise.all([
    prisma.orderMatch.findFirst({ where: { orderId: a.orderId, playedBy: "BOOSTER" }, orderBy: { gameEndAt: "desc" }, select: { gameEndAt: true } }),
    prisma.orderMessage.findFirst({ where: { senderId: a.boosterId, conversation: { orderId: a.orderId } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.orderSession.findFirst({ where: { orderId: a.orderId, boosterId: a.boosterId }, orderBy: { startedAt: "desc" }, select: { startedAt: true, endedAt: true } }),
    prisma.orderEvent.findFirst({ where: { orderId: a.orderId, type: "ORDER_RESUMED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.orderProgressUpdate.findFirst({ where: { orderId: a.orderId, boosterId: a.boosterId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const session = lastSession ? (lastSession.endedAt ?? now) : null;
  return [a.assignedAt, a.startedAt, lastGame?.gameEndAt, lastMessage?.createdAt, session, lastResume?.createdAt, lastUpdate?.createdAt]
    .filter((d): d is Date => !!d)
    .reduce((m, d) => (d > m ? d : m), new Date(0));
}

function notify(userId: string, type: "STALL_NO_CONTACT" | "STALL_WARNING" | "STALL_FINAL_WARNING", orderId: string, meta: Record<string, unknown>, dedupeKey: string) {
  return createNotification(userId, type, orderId, { orderId, ...meta }, "system", { dedupeKey }).catch((e) =>
    logger.warn("Stall notification failed", { type, error: e instanceof Error ? e.message : "unknown" })
  );
}

function queueEmail(a: Candidate, kind: "warning" | "final", hours: number, releaseHours: number, key: string) {
  return prisma.$transaction((tx) =>
    enqueueOutbox(tx, [
      { type: "EMAIL_BOOSTER_STALL", dedupeKey: key, payload: { orderId: a.orderId, boosterId: a.boosterId, assignmentId: a.id, kind, hours, releaseHours } },
    ])
  );
}

/**
 * One assignment, one step (the job and the test tool). `now` is the clock
 * the rules are checked against; `actualNow` stamps the release (the test
 * tool checks against a simulated time but releases at the real one).
 */
export async function processStalledAssignment(
  a: Candidate,
  s: StallSettings,
  now: Date,
  actualNow: Date = now
): Promise<{ contact: boolean; stage: "release" | "final" | "email" | null; released?: boolean }> {
  let contact = false;
  // 1. No hello to the customer 45 minutes after the claim: alert with sound.
  if (!a.stallSoundAlertedAt && now.getTime() - a.assignedAt.getTime() >= s.contactMin * 60_000) {
    const marked = await prisma.orderBoosterAssignment.updateMany({ where: { id: a.id, stallSoundAlertedAt: null }, data: { stallSoundAlertedAt: now } });
    if (marked.count === 1) {
      const said = await prisma.orderMessage.count({
        where: { senderId: a.boosterId, conversation: { orderId: a.orderId }, createdAt: { gte: a.assignedAt } },
      });
      if (said === 0) {
        await notify(a.boosterId, "STALL_NO_CONTACT", a.orderId, { minutes: s.contactMin }, `stall-contact:${a.id}`);
        contact = true;
      }
    }
  }

  const last = await lastBoosterActivity(a, now);
  const stage = stallStage(a, last, now, s);
  if (!stage) return { contact, stage };
  const idleHours = Math.floor((now.getTime() - last.getTime()) / HOUR);

  if (stage === "release") {
    const r = await autoReleaseStalledAssignment(a.id, { hours: s.releaseHours, now: actualNow });
    return { contact, stage, released: !!r };
  }

  // Mark first (conditional on what was read), then send.
  const field = stage === "final" ? "stallFinalWarnedAt" : "stallEmailedAt";
  const marked = await prisma.orderBoosterAssignment.updateMany({
    where: { id: a.id, status: { in: [...HELD] }, [field]: a[field] },
    // A final warning also covers the 2 h email for this quiet spell.
    data: stage === "final" ? { stallFinalWarnedAt: now, stallEmailedAt: now } : { stallEmailedAt: now },
  });
  if (marked.count === 0) return { contact, stage: null };
  const key = `stall-${stage}:${a.id}:${last.getTime()}`;
  if (stage === "final") {
    await notify(a.boosterId, "STALL_FINAL_WARNING", a.orderId, { hours: idleHours }, key);
    await queueEmail(a, "final", idleHours, s.releaseHours, key);
  } else {
    await notify(a.boosterId, "STALL_WARNING", a.orderId, { hours: idleHours, releaseHours: s.releaseHours }, key);
    await queueEmail(a, "warning", idleHours, s.releaseHours, key);
  }
  return { contact, stage };
}

const CANDIDATE_SELECT = {
  id: true,
  orderId: true,
  boosterId: true,
  assignedAt: true,
  startedAt: true,
  stallSoundAlertedAt: true,
  stallEmailedAt: true,
  stallFinalWarnedAt: true,
} as const;

/* ------------------------------------------------------------------ */
/* Test tool (STALL_TEST_TOOLS=1 only)                                 */
/* ------------------------------------------------------------------ */

export const STALL_TEST_STEPS = ["contact", "email", "final", "release"] as const;
export type StallTestStep = (typeof STALL_TEST_STEPS)[number];

export class StallTestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "StallTestError";
  }
}

export function stallTestToolsEnabled(): boolean {
  return process.env.STALL_TEST_TOOLS === "1";
}

/**
 * Test tool for the order's customer: run one step on this order now, as if
 * the time had passed (45 min after the claim, 2 h / 23 h / 24 h after the
 * booster's last activity). Everything is real: notifications, emails, and
 * at the last step the order is taken back and the booster fined.
 * Only when STALL_TEST_TOOLS=1; only the order's customer.
 */
export async function runStallTestStep(orderId: string, customerId: string, step: StallTestStep) {
  if (!stallTestToolsEnabled()) throw new StallTestError("Test tools are off.", 404);
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true, status: true } });
  if (!order || order.userId !== customerId) throw new StallTestError("Order not found.", 404);
  if (!["CLAIMED", "IN_PROGRESS"].includes(order.status)) {
    throw new StallTestError(
      order.status === "PAUSED" ? "The order is paused: resume it first (a pause stops the clock)." : "The order has no booster working on it.",
      409
    );
  }
  const a = await prisma.orderBoosterAssignment.findFirst({ where: { orderId, status: { in: [...HELD] } }, select: CANDIDATE_SELECT });
  if (!a) throw new StallTestError("The order has no booster working on it.", 409);

  const s = await stallSettings();
  const realNow = new Date();
  const last = await lastBoosterActivity(a, realNow);
  /** The simulated clock: base + ms (+1 min margin), never before the real time. */
  const at = (base: Date, ms: number) => new Date(Math.max(realNow.getTime(), base.getTime() + ms + 60_000));
  // Later steps skip the 45-minute check (it has its own button).
  const skipContact = { ...a, stallSoundAlertedAt: a.stallSoundAlertedAt ?? realNow };

  if (step === "contact") {
    if (a.stallSoundAlertedAt) return { done: false, message: "The 45-minute alert was already sent for this order." };
    const r = await processStalledAssignment({ ...a, stallEmailedAt: realNow, stallFinalWarnedAt: a.stallFinalWarnedAt }, s, at(a.assignedAt, s.contactMin * 60_000), realNow);
    return r.contact
      ? { done: true, message: "Sent the no-message alert (with sound) to the booster." }
      : { done: false, message: "Not sent: the booster has already messaged you on this order." };
  }
  if (step === "email") {
    const r = await processStalledAssignment(skipContact, s, at(last, s.emailHours * HOUR), realNow);
    return r.stage === "email"
      ? { done: true, message: `Sent the ${s.emailHours} h warning email and notification to the booster.` }
      : { done: false, message: "Already sent for this quiet spell. The booster must act again (message, game, update) before it can be sent again." };
  }
  if (step === "final") {
    const r = await processStalledAssignment(skipContact, s, at(last, Math.max(s.releaseHours - 1, s.emailHours) * HOUR), realNow);
    return r.stage === "final"
      ? { done: true, message: "Sent the final warning (taken back in 1 hour) to the booster." }
      : { done: false, message: "The final warning was already sent for this quiet spell. Use the last step." };
  }
  // release: the final warning must have gone out for this quiet spell, as in production.
  if (!a.stallFinalWarnedAt || a.stallFinalWarnedAt < last) {
    throw new StallTestError("Send the final warning first (step 3), as the real job does.", 409);
  }
  const releaseAt = new Date(Math.max(last.getTime() + s.releaseHours * HOUR, a.stallFinalWarnedAt.getTime() + FINAL_WARNING_MIN_LEAD_MS) + 60_000);
  const r = await processStalledAssignment(skipContact, s, releaseAt, realNow);
  return r.released
    ? { done: true, message: "The order was taken back from the booster and the fine was issued." }
    : { done: false, message: "Nothing was done: the order changed in the meantime. Refresh the page." };
}

export async function runStalledOrders(now = new Date(), limit = 200) {
  const s = await stallSettings();
  const earliest = Math.min(s.contactMin * 60_000, s.emailHours * HOUR);
  const candidates: Candidate[] = await prisma.orderBoosterAssignment.findMany({
    where: {
      status: { in: [...HELD] },
      order: { status: { in: ["CLAIMED", "IN_PROGRESS"] } },
      assignedAt: { lte: new Date(now.getTime() - earliest) },
    },
    select: CANDIDATE_SELECT,
    orderBy: { assignedAt: "asc" },
    take: limit,
  });

  let contactAlerts = 0;
  let stallEmails = 0;
  let finalWarnings = 0;
  let released = 0;
  let queued = false;

  for (const a of candidates) {
    try {
      const r = await processStalledAssignment(a, s, now);
      if (r.contact) contactAlerts++;
      if (r.stage === "email") stallEmails++;
      if (r.stage === "final") finalWarnings++;
      if (r.stage === "release" && r.released) released++;
      if (r.stage === "email" || r.stage === "final") queued = true;
    } catch (e) {
      logger.error("Stalled order check failed", { assignmentId: a.id, error: e instanceof Error ? e.message : "unknown" });
    }
  }
  if (queued) await dispatchOutbox({ limit: 50 }).catch(() => {});
  return { stallContactAlerts: contactAlerts, stallEmails, stallFinalWarnings: finalWarnings, stallReleased: released };
}
