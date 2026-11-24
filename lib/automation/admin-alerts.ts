// Server-only module.
/**
 * Admin alerts (2026-11-24). Four checks run with the `sla-warnings` job
 * (every 5 minutes on cron-job.org), so no new cron entry is needed:
 *
 *   1. Job health: a scheduled job that failed, or has not run for much
 *      longer than its schedule (cron-job.org stopped calling it).
 *   2. Unclaimed orders: a paid order with no booster `unclaimed_alert_min`
 *      (30) after payment or release -> admins and every booster who could
 *      take it.
 *   3. Completions waiting for an admin decision `completion_wait_alert_hours`
 *      (4) -> admins, then once a day.
 *   4. Support tickets whose last message is from the customer and has had
 *      no reply for `ticket_reply_alert_hours` (12) -> the assigned admin, or
 *      every admin.
 *
 * Every alert has a dedupe key, so running twice never alerts twice.
 * Alerts are in-app notifications (bell, sound, notification list).
 */
import prisma from "@/lib/prisma";
import { getConfig } from "@/lib/config";
import { createNotification } from "@/lib/notifications/service";
import type { NotificationEventMetadata, NotificationEventType } from "@/lib/notifications/types";
import { logger } from "@/lib/logger";
import { VERIFIED_PAYMENT_WHERE } from "@/lib/orders/payment-gate";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/assignments/types";
import { eligibilityProblem } from "@/lib/pool/eligibility";
import { boosterBlockReason, loadBoosterForPool, type BoosterForPool } from "@/lib/pool/service";
import { getGameServiceOffer } from "@/lib/catalog/game-services";

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * How long each scheduled job may go without running before it counts as
 * late: about 3x its cron-job.org schedule (docs/DEPLOY_VERCEL.md).
 * Jobs not listed (fx-rates, auto-confirm) are not watched.
 */
export const JOB_MAX_GAP_MIN: Record<string, number> = {
  "close-bidding": 10, // every minute
  "outbox-dispatch": 20, // every 5 minutes
  "sla-warnings": 20, // every 5 minutes
  "close-stale-holds": 45, // every 15 minutes
  "tracker-retention": 26 * 60, // daily
};

export interface JobProblem {
  job: string;
  problem: "late" | "failed";
  /** Minutes since the last start (late). */
  minutes: number | null;
  error: string | null;
  /** Identifies this incident (one alert per incident). */
  since: string;
}

/** Watched jobs that are late or whose last run failed (also shown on the admin dashboard). */
export async function jobProblems(now = new Date()): Promise<JobProblem[]> {
  const rows = await prisma.jobLease.findMany({ where: { name: { in: Object.keys(JOB_MAX_GAP_MIN) } } });
  const out: JobProblem[] = [];
  for (const r of rows) {
    const gap = JOB_MAX_GAP_MIN[r.name];
    const last = r.lastStartedAt;
    if (last && now.getTime() - last.getTime() > gap * MIN) {
      out.push({ job: r.name, problem: "late", minutes: Math.round((now.getTime() - last.getTime()) / MIN), error: null, since: last.toISOString() });
    } else if (r.lastStatus === "error" && r.lastFinishedAt) {
      out.push({ job: r.name, problem: "failed", minutes: null, error: (r.lastError ?? "unknown error").slice(0, 200), since: r.lastFinishedAt.toISOString() });
    }
  }
  return out;
}

async function adminIds(): Promise<string[]> {
  return (await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((u) => u.id);
}

async function notifyAll(userIds: string[], type: NotificationEventType, orderId: string | undefined, meta: NotificationEventMetadata, dedupeKey: string) {
  if (!userIds.length) return 0;
  // Skip who already has this alert (the unique index still guards races).
  const already = new Set(
    (await prisma.notification.findMany({ where: { dedupeKey, userId: { in: userIds } }, select: { userId: true } })).map((n) => n.userId)
  );
  let sent = 0;
  for (const userId of userIds.filter((id) => !already.has(id))) {
    try {
      await createNotification(userId, type, orderId, meta, "system", { dedupeKey });
      sent++;
    } catch (e) {
      logger.warn("Admin alert failed", { type, error: e instanceof Error ? e.message : "unknown" });
    }
  }
  return sent;
}

/* 1. Job health ------------------------------------------------------ */

export async function runJobHealthAlerts(now = new Date()) {
  const problems = await jobProblems(now);
  if (!problems.length) return { jobAlerts: 0 };
  const admins = await adminIds();
  for (const p of problems) {
    await notifyAll(admins, "SYSTEM_JOB_ALERT", undefined, { job: p.job, problem: p.problem, minutes: p.minutes, error: p.error }, `job-${p.problem}:${p.job}:${p.since}`);
  }
  return { jobAlerts: problems.length };
}

/* 2. Unclaimed orders ------------------------------------------------ */

export async function runUnclaimedOrderAlerts(now = new Date(), limit = 50) {
  const minutes = await getConfig("unclaimed_alert_min");
  const cutoff = new Date(now.getTime() - minutes * MIN);
  const orders = await prisma.order.findMany({
    where: {
      status: "PENDING",
      ...VERIFIED_PAYMENT_WHERE,
      paymentVerifiedAt: { lte: cutoff },
      assignments: { none: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } },
      // Not while reserved for a chosen booster, nor while a bidding window is open.
      AND: [
        { OR: [{ preferredUntil: null }, { preferredUntil: { lte: cutoff } }] },
        { OR: [{ biddingClosesAt: null }, { biddingClosesAt: { lte: now } }] },
      ],
    },
    select: {
      id: true,
      gameSlug: true,
      serviceSlug: true,
      configuration: true,
      biddingRound: true,
      paymentVerifiedAt: true,
      riotAccount: { select: { platform: true } },
      assignments: { select: { boosterId: true, endedAt: true } },
    },
    orderBy: { paymentVerifiedAt: "asc" },
    take: limit,
  });

  // Waiting since payment, or since the last booster let it go.
  const due = orders.filter((o) => {
    const ends = o.assignments.map((a) => a.endedAt).filter((d): d is Date => !!d);
    const since = [o.paymentVerifiedAt!, ...ends].reduce((m, d) => (d > m ? d : m));
    return since <= cutoff;
  });
  if (!due.length) return { unclaimedAlerts: 0 };

  const admins = await adminIds();
  // Boosters who can take new orders now (loaded once per run).
  const boosterRows = await prisma.user.findMany({ where: { role: "BOOSTER", boosterProfile: { isNot: null } }, select: { id: true }, take: 500 });
  const boosters: BoosterForPool[] = [];
  for (const b of boosterRows) {
    const loaded = await loadBoosterForPool(b.id).catch(() => null);
    if (loaded && !boosterBlockReason(loaded) && loaded.activeCount < loaded.limit) boosters.push(loaded);
  }

  let alerted = 0;
  for (const o of due) {
    const key = `unclaimed:${o.id}:${o.biddingRound}`;
    await notifyAll(admins, "ORDER_UNCLAIMED", o.id, { audience: "admin", minutes }, key);
    const heldBefore = new Set(o.assignments.map((a) => a.boosterId));
    const eligible = boosters.filter(
      (b) =>
        !heldBefore.has(b.id) &&
        eligibilityProblem(b.permissions, { gameSlug: o.gameSlug, serviceSlug: o.serviceSlug, configuration: o.configuration, region: o.riotAccount?.platform }) === null
    );
    const service = getGameServiceOffer(o.gameSlug, o.serviceSlug)?.title ?? o.serviceSlug;
    // No order link for boosters: they open it from Available Orders.
    await notifyAll(eligible.map((b) => b.id), "ORDER_UNCLAIMED", undefined, { audience: "booster", ref: o.id.slice(-8).toUpperCase(), service }, key);
    alerted++;
  }
  return { unclaimedAlerts: alerted };
}

/* 3. Completions waiting for an admin -------------------------------- */

export async function runCompletionWaitingAlerts(now = new Date(), limit = 100) {
  const hours = await getConfig("completion_wait_alert_hours");
  const requests = await prisma.orderCompletionRequest.findMany({
    where: { status: { in: ["PENDING", "DISPUTED"] }, createdAt: { lte: new Date(now.getTime() - hours * HOUR) } },
    select: { id: true, orderId: true, status: true, createdAt: true, disputedAt: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let alerted = 0;
  let admins: string[] | null = null;
  for (const r of requests) {
    const since = r.status === "DISPUTED" ? r.disputedAt ?? r.createdAt : r.createdAt;
    const ageH = (now.getTime() - since.getTime()) / HOUR;
    if (ageH < hours) continue;
    // First reminder after `hours`, then one a day.
    const n = Math.floor((ageH - hours) / 24);
    admins ??= await adminIds();
    await notifyAll(admins, "COMPLETION_WAITING", r.orderId, { hours: Math.floor(ageH), disputed: r.status === "DISPUTED" }, `completion-wait:${r.id}:${r.status}:${n}`);
    alerted++;
  }
  return { completionAlerts: alerted };
}

/* 4. Support tickets waiting for a reply ------------------------------ */

export async function runTicketWaitingAlerts(now = new Date(), limit = 100) {
  const hours = await getConfig("ticket_reply_alert_hours");
  const cutoff = new Date(now.getTime() - hours * HOUR);
  const tickets = await prisma.supportTicket.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt: { lte: cutoff } },
    select: {
      id: true,
      subject: true,
      createdAt: true,
      assignedAdminId: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, isAdminReply: true, createdAt: true } },
    },
    take: limit,
  });
  let alerted = 0;
  let admins: string[] | null = null;
  for (const t of tickets) {
    const last = t.messages[0];
    if (last?.isAdminReply) continue; // the customer has an answer
    const since = last?.createdAt ?? t.createdAt;
    if (since > cutoff) continue;
    const to = t.assignedAdminId ? [t.assignedAdminId] : (admins ??= await adminIds());
    await notifyAll(
      to,
      "SUPPORT_TICKET_WAITING",
      undefined,
      { ticketSubject: t.subject, hours: Math.floor((now.getTime() - since.getTime()) / HOUR), ticketId: t.id },
      `ticket-wait:${t.id}:${last?.id ?? "new"}`
    );
    alerted++;
  }
  return { ticketAlerts: alerted };
}

/** All four checks; one failing never stops the others. */
export async function runAdminAlerts(now = new Date()) {
  const out: Record<string, unknown> = {};
  for (const [name, run] of [
    ["jobHealth", runJobHealthAlerts],
    ["unclaimed", runUnclaimedOrderAlerts],
    ["completions", runCompletionWaitingAlerts],
    ["tickets", runTicketWaitingAlerts],
  ] as const) {
    try {
      Object.assign(out, await run(now));
    } catch (e) {
      out[`${name}Error`] = e instanceof Error ? e.message : "unknown";
      logger.warn("Admin alert check failed", { check: name, error: e instanceof Error ? e.message : "unknown" });
    }
  }
  return out;
}
