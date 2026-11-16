/**
 * Order progress from Riot data [registry F8], shared by the order page and
 * the booster's "Complete" check, so both always agree.
 *
 *   - League of Legends rank services: Riot League-V4 current rank vs the
 *     purchased target rank (start = Riot baseline, else the declared rank).
 *   - Win Boost: wins attributed to the booster vs the wins ordered.
 *   - Everything else (Valorant, TFT, placements, normal matches, mastery,
 *     arena): no automatic check ("none").
 */
import {
  computeRankProgress,
  computeWinProgress,
  normalizeRank,
} from "@/lib/services/games/league-of-legends/progression.service";
import type { SourcedRank } from "@/lib/services/games/league-of-legends/riot.types";
import type { WorkspaceProgressDTO } from "./workspace-types";

/** Games whose current rank is synchronised from Riot (League-V4). */
export const RIOT_RANK_GAMES = new Set(["league-of-legends"]);

export function sourcedRank(
  tier: string | null | undefined,
  division: string | null | undefined,
  lp: number | null | undefined,
  source: SourcedRank["source"],
  at: Date | null,
  lpAssumed = false
): SourcedRank | null {
  const r = normalizeRank(tier, division, lp ?? 0);
  return r ? { ...r, source, at, lpAssumed } : null;
}

/** Catalog selection ({tierId:"diamond", divisionId:"iv"}) -> rank. */
export function rankFromSelection(value: unknown, at: Date): SourcedRank | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { tierId?: unknown; divisionId?: unknown };
  return sourcedRank(v.tierId as string, (v.divisionId as string) ?? null, 0, "order", at, true);
}

export interface ProgressRiotAccount {
  baselineTier?: string | null;
  baselineDivision?: string | null;
  baselineLp?: number | null;
  baselineAt?: Date | null;
  observedTier?: string | null;
  observedDivision?: string | null;
  observedLp?: number | null;
  observedAt?: Date | null;
}

export function computeOrderProgress(input: {
  gameSlug: string;
  serviceSlug: string;
  configuration: unknown;
  createdAt: Date;
  riotAccount: ProgressRiotAccount | null;
  winsAttributed: number;
}): { progress: WorkspaceProgressDTO; start: SourcedRank | null; current: SourcedRank | null; target: SourcedRank | null } {
  const cfg = (input.configuration ?? {}) as Record<string, unknown>;
  const ra = input.riotAccount;
  const riotTracked = RIOT_RANK_GAMES.has(input.gameSlug);
  const target = rankFromSelection(cfg.targetRank, input.createdAt);
  const declaredStart = rankFromSelection(cfg.currentRank, input.createdAt);
  // League-V4 data describes League of Legends only: never used for another game.
  const baseline =
    riotTracked && ra?.baselineAt ? sourcedRank(ra.baselineTier, ra.baselineDivision, ra.baselineLp, "riot", ra.baselineAt) : null;
  const current =
    riotTracked && ra?.observedAt ? sourcedRank(ra.observedTier, ra.observedDivision, ra.observedLp, "riot", ra.observedAt) : null;
  const start = baseline ?? declaredStart;

  const none: WorkspaceProgressDTO = {
    kind: "none",
    status: "unavailable",
    percent: null,
    lpDelta: null,
    lpRemaining: null,
    stepsDelta: null,
    demoted: false,
    stale: false,
    startLpAssumed: false,
  };

  if (riotTracked && target && start) {
    const p = computeRankProgress({ start, current, target });
    return { progress: { kind: "rank", ...p, status: p.status }, start, current, target };
  }
  if (input.serviceSlug === "win-boost") {
    const ordered = typeof cfg.wins === "number" ? cfg.wins : Number(cfg.wins) || null;
    const w = computeWinProgress(input.winsAttributed, ordered);
    return {
      progress: {
        ...none,
        kind: "wins",
        status: w.percent === null ? "unavailable" : w.percent >= 100 ? "complete" : "in_progress",
        percent: w.percent,
        wins: { attributed: input.winsAttributed, ordered },
      },
      start,
      current,
      target,
    };
  }
  return { progress: none, start, current, target };
}
