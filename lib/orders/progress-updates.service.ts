// Server-only module.
/**
 * Booster progress updates (decision 2026-11-17).
 *
 * Without a Riot production key the order page cannot read ranks from Riot,
 * so the booster reports the account's current rank (tier, division, and
 * optional LP / RR) from the order's own catalog rank system. The page shows
 * start -> current -> target and a percentage from these reports; the
 * customer can check them on OP.GG / tracker.gg (selfCheckLink) and the
 * completion still needs proof screenshots + confirmation.
 *
 * Asked for when the booster ends a play session; a reminder goes to the
 * booster after 24 h without an update while the order is in progress.
 */
import prisma from "@/lib/prisma";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { formatRankLabel, getRankSystem, getRankSystemsByGame, getTier, rankScore } from "@/lib/catalog/rank-systems";
import { enqueueOutbox, dispatchOutbox } from "@/lib/payments/outbox";
import { createNotification } from "@/lib/notifications/service";
import { logger } from "@/lib/logger";

export class ProgressUpdateError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ProgressUpdateError";
  }
}

export const PROGRESS_REMINDER_HOURS = 24;
const MIN_GAP_MS = 20_000;

/* ------------------------------------------------------------------ */
/* Rank ladder                                                         */
/* ------------------------------------------------------------------ */

/** The rank system an order's ranks are expressed in (null: game has none). */
export function orderRankSystemId(gameSlug: string, serviceSlug: string): string | null {
  const offer = getGameServiceOffer(gameSlug, serviceSlug);
  const field = offer?.fields.find((f) => f.key === "targetRank" || f.key === "currentRank");
  const fromField = field && "rankSystemId" in field && typeof field.rankSystemId === "string" ? field.rankSystemId : undefined;
  return fromField ?? offer?.rankSystemId ?? getRankSystemsByGame(gameSlug)[0]?.id ?? null;
}

/** "LP" for League / TFT, "RR" for VALORANT. */
export function pointsLabel(gameSlug: string): "LP" | "RR" {
  return gameSlug === "valorant" ? "RR" : "LP";
}

export interface RankRef {
  tierId: string;
  divisionId: string | null;
}

/** Position on the ladder: every tier x division is one step (lowest = 0). */
export function stepIndex(rankSystemId: string, r: RankRef | null): number | null {
  if (!r) return null;
  const system = getRankSystem(rankSystemId);
  if (!system) return null;
  let i = 0;
  for (const t of [...system.tiers].sort((a, b) => a.order - b.order)) {
    const divs = t.divisions ?? [];
    if (t.id === r.tierId) {
      if (divs.length === 0) return i;
      const d = divs.findIndex((x) => x.id === r.divisionId);
      return d < 0 ? null : i + d;
    }
    i += Math.max(divs.length, 1);
  }
  return null;
}

/** A rank from an order's configuration ({ tierId, divisionId }), if valid. */
export function rankRefOf(rankSystemId: string, value: unknown): RankRef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { tierId?: unknown; divisionId?: unknown };
  if (typeof v.tierId !== "string") return null;
  const ref = { tierId: v.tierId, divisionId: typeof v.divisionId === "string" ? v.divisionId : null };
  return stepIndex(rankSystemId, ref) === null ? null : ref;
}

/**
 * The bought rank range of an order (start -> target, both included), or
 * null when the order has no valid start and target (Win Boost, placements…).
 */
export function orderRankRange(rankSystemId: string, configuration: unknown) {
  const cfg = (configuration ?? {}) as Record<string, unknown>;
  const start = rankRefOf(rankSystemId, cfg.currentRank);
  const target = rankRefOf(rankSystemId, cfg.targetRank);
  const from = stepIndex(rankSystemId, start);
  const to = stepIndex(rankSystemId, target);
  if (!start || !target || from === null || to === null || to <= from) return null;
  return { start, target, from, to };
}

export interface RankOption {
  tierId: string;
  name: string;
  iconSrc: string | null;
  divisions: { id: string; label: string }[];
}

/** Ranks the booster may report: only those inside the order's range, lowest first. */
export function allowedRankOptions(rankSystemId: string, configuration: unknown): RankOption[] {
  const range = orderRankRange(rankSystemId, configuration);
  const system = getRankSystem(rankSystemId);
  if (!range || !system) return [];
  const inRange = (r: RankRef) => {
    const s = stepIndex(rankSystemId, r);
    return s !== null && s >= range.from && s <= range.to;
  };
  const out: RankOption[] = [];
  for (const t of [...system.tiers].sort((a, b) => a.order - b.order)) {
    const divs = t.divisions ?? [];
    if (divs.length === 0) {
      if (inRange({ tierId: t.id, divisionId: null })) out.push({ tierId: t.id, name: t.name, iconSrc: t.iconSrc ?? null, divisions: [] });
      continue;
    }
    const ok = divs.filter((d) => inRange({ tierId: t.id, divisionId: d.id })).map((d) => ({ id: d.id, label: d.label }));
    if (ok.length) out.push({ tierId: t.id, name: t.name, iconSrc: t.iconSrc ?? null, divisions: ok });
  }
  return out;
}

export interface ReportedProgress {
  status: "unavailable" | "invalid" | "waiting" | "in_progress" | "complete";
  percent: number | null;
  /** Divisions gained since the start (negative: below the start). */
  stepsDelta: number | null;
}

/**
 * Progress from the reported rank. Inside a division the LP / RR count as a
 * fraction of the next step (capped at 99), so 50 LP is half a division.
 */
export function computeReportedProgress(
  rankSystemId: string,
  start: RankRef | null,
  current: (RankRef & { lp: number | null }) | null,
  target: RankRef | null
): ReportedProgress {
  const s = stepIndex(rankSystemId, start);
  const t = stepIndex(rankSystemId, target);
  if (s === null || t === null) return { status: "unavailable", percent: null, stepsDelta: null };
  if (t <= s) return { status: "invalid", percent: null, stepsDelta: null };
  const c = stepIndex(rankSystemId, current);
  if (c === null || !current) return { status: "waiting", percent: null, stepsDelta: null };
  if (c >= t) return { status: "complete", percent: 100, stepsDelta: c - s };
  const hasDivisions = !!getTier(rankSystemId, current.tierId)?.divisions?.length;
  const frac = hasDivisions && current.lp !== null ? Math.min(Math.max(current.lp, 0), 99) / 100 : 0;
  const pct = Math.round(((c + frac - s) / (t - s)) * 100);
  return { status: "in_progress", percent: Math.min(99, Math.max(0, pct)), stepsDelta: c - s };
}

/* ------------------------------------------------------------------ */
/* Self-check link                                                     */
/* ------------------------------------------------------------------ */

const OPGG_REGION: Record<string, string> = {
  EUW1: "euw", EUN1: "eune", NA1: "na", KR: "kr", BR1: "br", LA1: "lan", LA2: "las", OC1: "oce", TR1: "tr", RU: "ru",
  JP1: "jp", ME1: "me", SG2: "sg", TW2: "tw", VN2: "vn", PH2: "ph", TH2: "th",
};

/**
 * Public profile page where the customer can check the rank themselves.
 * Only a link (no data is fetched or copied), so no API key is involved.
 */
export function selfCheckLink(
  gameSlug: string,
  account: { gameName: string; tagLine: string; platform: string | null } | null
): { label: string; url: string } | null {
  if (!account?.gameName || !account.tagLine) return null;
  const name = encodeURIComponent(account.gameName.trim());
  const tag = encodeURIComponent(account.tagLine.trim().replace(/^#/, ""));
  if (gameSlug === "valorant") {
    return { label: "Check on tracker.gg", url: `https://tracker.gg/valorant/profile/riot/${name}%23${tag}/overview` };
  }
  const region = account.platform ? OPGG_REGION[account.platform.toUpperCase()] : undefined;
  if (!region) return null;
  if (gameSlug === "teamfight-tactics") return { label: "Check on OP.GG", url: `https://op.gg/tft/summoners/${region}/${name}-${tag}` };
  if (gameSlug === "league-of-legends") return { label: "Check on OP.GG", url: `https://op.gg/lol/summoners/${region}/${name}-${tag}` };
  return null;
}

/* ------------------------------------------------------------------ */
/* Post / list                                                         */
/* ------------------------------------------------------------------ */

export async function postProgressUpdate(p: { orderId: string; boosterId: string; tierId: string; divisionId?: string | null; lp?: number | null }) {
  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      gameSlug: true,
      serviceSlug: true,
      configuration: true,
      assignments: { where: { boosterId: p.boosterId, activeOrderId: p.orderId, status: "IN_PROGRESS" }, select: { id: true } },
    },
  });
  if (!order || order.assignments.length === 0) throw new ProgressUpdateError("Order not found.", 404);
  if (order.status !== "IN_PROGRESS") throw new ProgressUpdateError("Progress can only be updated while the order is in progress.", 409);

  const rankSystemId = orderRankSystemId(order.gameSlug, order.serviceSlug);
  if (!rankSystemId) throw new ProgressUpdateError("This game has no ranks to report.", 400);
  const tier = getTier(rankSystemId, p.tierId);
  if (!tier) throw new ProgressUpdateError("Choose a rank.");
  const divs = tier.divisions ?? [];
  const divisionId = divs.length ? p.divisionId ?? null : null;
  if (divs.length && !divs.some((d) => d.id === divisionId)) throw new ProgressUpdateError("Choose a division.");
  // Only ranks inside the bought range (decision 2026-11-17).
  const range = orderRankRange(rankSystemId, order.configuration);
  if (!range) throw new ProgressUpdateError("This order has no rank range to update.", 400);
  const step = stepIndex(rankSystemId, { tierId: tier.id, divisionId });
  if (step === null || step < range.from || step > range.to) {
    throw new ProgressUpdateError(
      `Choose a rank between ${formatRankLabel(rankSystemId, range.start)} and ${formatRankLabel(rankSystemId, range.target)}.`
    );
  }
  let lp: number | null = null;
  if (p.lp !== undefined && p.lp !== null) {
    if (!Number.isInteger(p.lp) || p.lp < 0 || p.lp > 5000) throw new ProgressUpdateError(`${pointsLabel(order.gameSlug)} must be a whole number from 0 to 5000.`);
    lp = p.lp;
  }

  const last = await prisma.orderProgressUpdate.findFirst({ where: { orderId: p.orderId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && Date.now() - last.createdAt.getTime() < MIN_GAP_MS) throw new ProgressUpdateError("You just posted an update. Wait a few seconds.", 429);

  const label = formatRankLabel(rankSystemId, { tierId: tier.id, divisionId }) + (lp !== null ? ` ${lp} ${pointsLabel(order.gameSlug)}` : "");
  const update = await prisma.$transaction(async (tx) => {
    const u = await tx.orderProgressUpdate.create({
      data: { orderId: p.orderId, assignmentId: order.assignments[0].id, boosterId: p.boosterId, rankSystemId, tierId: tier.id, divisionId, lp },
    });
    // The open order pages refresh on this (status probe version).
    await tx.order.update({ where: { id: p.orderId }, data: { updatedAt: new Date() } });
    await tx.orderEvent.create({
      data: { orderId: p.orderId, type: "ORDER_PROGRESS_UPDATED", message: `Booster reported ${label}`, metadata: { updateId: u.id, boosterId: p.boosterId } },
    });
    await enqueueOutbox(tx, [
      {
        type: "NOTIFY",
        dedupeKey: `progress-update:${u.id}`,
        payload: { notification: "ORDER_PROGRESS_UPDATED", recipients: [order.userId], orderId: p.orderId, actorId: p.boosterId, metadata: { rank: label } },
      },
    ]);
    return u;
  });
  await dispatchOutbox({ limit: 5 }).catch(() => {});
  return { id: update.id, label };
}

export interface ProgressUpdateDTO {
  id: string;
  label: string;
  tierId: string;
  divisionId: string | null;
  lp: number | null;
  iconSrc: string | null;
  at: string;
}

export async function listProgressUpdates(orderId: string, limit = 30): Promise<ProgressUpdateDTO[]> {
  const rows = await prisma.orderProgressUpdate.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    label: formatRankLabel(r.rankSystemId, { tierId: r.tierId, divisionId: r.divisionId }),
    tierId: r.tierId,
    divisionId: r.divisionId,
    lp: r.lp,
    iconSrc: getTier(r.rankSystemId, r.tierId)?.iconSrc ?? null,
    at: r.createdAt.toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* Reminder (sla-warnings job)                                         */
/* ------------------------------------------------------------------ */

/**
 * In-progress orders with no rank update for PROGRESS_REMINDER_HOURS (since
 * the last update, or the start): one reminder to the booster per period.
 */
export async function runProgressReminders(now = new Date()) {
  const periodMs = PROGRESS_REMINDER_HOURS * 3_600_000;
  const orders = await prisma.order.findMany({
    where: { status: "IN_PROGRESS" },
    select: {
      id: true,
      assignments: { where: { status: "IN_PROGRESS" }, select: { boosterId: true, startedAt: true, activeOrderId: true } },
      progressUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
    take: 500,
  });
  let reminded = 0;
  for (const o of orders) {
    const a = o.assignments.find((x) => x.activeOrderId === o.id);
    if (!a?.startedAt) continue;
    const since = o.progressUpdates[0]?.createdAt ?? a.startedAt;
    const idle = now.getTime() - since.getTime();
    if (idle < periodMs) continue;
    const period = Math.floor(idle / periodMs);
    const dedupeKey = `progress-due:${o.id}:${since.getTime()}:${period}`;
    try {
      // One reminder per period (checked first; the unique key is the backstop).
      if (await prisma.notification.findFirst({ where: { dedupeKey }, select: { id: true } })) continue;
      await createNotification(a.boosterId, "PROGRESS_UPDATE_DUE", o.id, { hours: PROGRESS_REMINDER_HOURS }, "system", { dedupeKey });
      reminded++;
    } catch (e) {
      logger.warn("Progress reminder failed", { orderId: o.id, error: e instanceof Error ? e.message : "unknown" });
    }
  }
  return { progressReminders: reminded };
}

/**
 * Rank Boost completion (client PDF 2026-11-23): an order with a target rank
 * can only be submitted as complete once the booster's latest Rank Update
 * reaches that rank (e.g. Silver IV -> Gold IV needs "Gold IV" posted), so
 * the customer and the admin both see the final rank. Returns the target
 * label still to post, or null when nothing is missing (or the order has no
 * target rank: wins, placements, Arena, mastery...).
 */
export async function missingFinalRank(orderId: string): Promise<string | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { gameSlug: true, serviceSlug: true, configuration: true } });
  if (!order) return null;
  const cfg = (order.configuration ?? {}) as Record<string, unknown>;
  const target = cfg.targetRank as { tierId?: unknown; divisionId?: unknown } | undefined;
  if (!target || typeof target.tierId !== "string") return null;
  const rankSystemId = orderRankSystemId(order.gameSlug, order.serviceSlug);
  if (!rankSystemId) return null;
  const targetSel = { tierId: target.tierId, divisionId: typeof target.divisionId === "string" ? target.divisionId : null };
  const targetScore = rankScore(rankSystemId, targetSel);
  if (targetScore === null) return null;
  const latest = await prisma.orderProgressUpdate.findFirst({ where: { orderId }, orderBy: { createdAt: "desc" }, select: { tierId: true, divisionId: true } });
  const reached = latest ? rankScore(rankSystemId, { tierId: latest.tierId, divisionId: latest.divisionId }) : null;
  return reached !== null && reached >= targetScore ? null : formatRankLabel(rankSystemId, targetSel);
}
