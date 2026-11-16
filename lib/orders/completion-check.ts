// Server-only module.
/**
 * Booster "Complete" check (decision 2026-11-15).
 *
 * Before an order completes, the account's live progress is checked with
 * Riot: League of Legends rank services compare the current rank (refreshed
 * now from League-V4) with the purchased target; Win Boost compares tracked
 * wins with the wins ordered. Reached -> the order completes. Otherwise the
 * order stays in progress, admins are notified, and the booster is told to
 * keep going and that an admin will contact them.
 *
 * Services Riot cannot check (Valorant, TFT, placements, normal matches,
 * mastery, arena) or a failed refresh -> "cannot_verify": same path, an admin
 * reviews and can complete the order from the admin side.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatRank } from "@/lib/services/games/league-of-legends/progression.service";
import { computeOrderProgress, RIOT_RANK_GAMES } from "./order-progress";
import { CompletionNotConfirmedError } from "@/lib/assignments/types";
import { createNotification } from "@/lib/notifications/service";

/** A Riot observation older than this is not trusted for completion. */
export const COMPLETION_FRESHNESS_MS = 15 * 60_000;

export type CompletionCheck =
  | { result: "reached"; detail: string }
  | { result: "not_reached" | "cannot_verify"; reason: string; current: string | null; target: string | null };

async function defaultSync(orderId: string) {
  const { syncOrderRiotData } = await import("@/lib/services/games/league-of-legends/sync.service");
  return syncOrderRiotData(orderId);
}

export async function checkCompletion(
  orderId: string,
  opts: { sync?: (orderId: string) => Promise<unknown>; now?: Date } = {}
): Promise<CompletionCheck> {
  const now = opts.now ?? new Date();
  const base = await prisma.order.findUnique({ where: { id: orderId }, select: { gameSlug: true, serviceSlug: true, configuration: true } });
  if (!base) return { result: "cannot_verify", reason: "Order not found.", current: null, target: null };
  const cfg = (base.configuration ?? {}) as Record<string, unknown>;
  const checkable = RIOT_RANK_GAMES.has(base.gameSlug) && (!!cfg.targetRank || base.serviceSlug === "win-boost");
  if (!checkable) {
    return { result: "cannot_verify", reason: "This service cannot be checked automatically with Riot.", current: null, target: null };
  }

  // Refresh from Riot now; a failure is handled by the freshness check below.
  try {
    await (opts.sync ?? defaultSync)(orderId);
  } catch (e) {
    logger.warn("Completion check: Riot refresh failed", { orderId, error: e instanceof Error ? e.message : "unknown" });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { gameSlug: true, serviceSlug: true, configuration: true, createdAt: true, riotAccount: true },
  });
  if (!order) return { result: "cannot_verify", reason: "Order not found.", current: null, target: null };
  // Only games played inside booster sessions count (Phase 5).
  const winsAttributed = await prisma.orderMatch.count({ where: { orderId, win: true, playedBy: "BOOSTER" } });
  const { progress, current, target } = computeOrderProgress({
    gameSlug: order.gameSlug,
    serviceSlug: order.serviceSlug,
    configuration: order.configuration,
    createdAt: order.createdAt,
    riotAccount: order.riotAccount,
    winsAttributed,
  });
  const targetLabel = target ? formatRank(target, false) : null;
  const currentLabel = current ? formatRank(current) : null;

  if (progress.kind === "rank") {
    const fresh = !!current?.at && now.getTime() - current.at.getTime() <= COMPLETION_FRESHNESS_MS;
    if (!current || !fresh) {
      return { result: "cannot_verify", reason: "The current rank could not be refreshed from Riot.", current: currentLabel, target: targetLabel };
    }
    if (progress.status === "complete") return { result: "reached", detail: `Riot shows ${currentLabel} (target ${targetLabel}).` };
    if (progress.status === "in_progress" || progress.status === "indeterminate") {
      return { result: "not_reached", reason: `Riot shows ${currentLabel}; the target is ${targetLabel}.`, current: currentLabel, target: targetLabel };
    }
    return { result: "cannot_verify", reason: "The starting or target rank is not usable for a check.", current: currentLabel, target: targetLabel };
  }
  if (progress.kind === "wins" && progress.wins) {
    const w = `${progress.wins.attributed} of ${progress.wins.ordered ?? "?"} wins`;
    if (progress.status === "complete") return { result: "reached", detail: `Tracked ${w}.` };
    if (progress.status === "in_progress") return { result: "not_reached", reason: `Tracked ${w}.`, current: w, target: null };
  }
  return { result: "cannot_verify", reason: "Progress could not be checked with Riot.", current: currentLabel, target: targetLabel };
}

/**
 * Booster completion gate: Riot must confirm the target (lib/orders/
 * completion-check.ts). Only runs for the booster holding an in-progress
 * order; anything else falls through to the normal checks. Not confirmed ->
 * order event + admins notified (once per hour per order) + error with the
 * reason for the booster. Admins complete without this check.
 */
export async function assertBoosterCompletionConfirmed(assignmentId: string, boosterId: string) {
  const a = await prisma.orderBoosterAssignment.findUnique({
    where: { id: assignmentId },
    select: { boosterId: true, status: true, orderId: true, order: { select: { status: true } } },
  });
  if (!a || a.boosterId !== boosterId || a.status !== "IN_PROGRESS" || a.order?.status !== "IN_PROGRESS") return;
  const check = await checkCompletion(a.orderId);
  if (check.result === "reached") return;

  try {
    await prisma.orderEvent.create({
      data: {
        orderId: a.orderId,
        type: "COMPLETION_NOT_CONFIRMED",
        message: check.reason,
        metadata: { assignmentId, boosterId, result: check.result, current: check.current, target: check.target },
      },
    });
    const hour = new Date().toISOString().slice(0, 13);
    // Once per hour per order: skip if this hour was already notified.
    const already = await prisma.notification.findFirst({ where: { dedupeKey: `completion-review:${a.orderId}:${hour}` }, select: { id: true } });
    const admins = already ? [] : await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await Promise.all(
      admins.map((ad) =>
        createNotification(ad.id, "COMPLETION_REVIEW", a.orderId, { reason: check.reason }, boosterId, {
          dedupeKey: `completion-review:${a.orderId}:${hour}`,
        })
      )
    );
  } catch (e) {
    logger.warn("Completion review notification failed", { orderId: a.orderId, error: e instanceof Error ? e.message : "unknown" });
  }
  throw new CompletionNotConfirmedError(check.result, check.reason, check.current, check.target);
}
