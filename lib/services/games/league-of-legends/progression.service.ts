/**
 * League of Legends rank progression. Pure functions, no I/O, no UI.
 *
 * Normalization ("ladder points"):
 *  - IRON..DIAMOND each have four divisions (IV -> I) of 100 LP:
 *      score = tierIndex * 400 + divisionIndex * 100 + clamp(lp, 0, 100)
 *  - MASTER, GRANDMASTER and CHALLENGER share one open-ended LP scale that
 *    starts where Diamond I ends (score 2800):
 *      score = 2800 + max(lp, 0)
 *    Grandmaster / Challenger are not fixed LP values: they are ladder
 *    positions whose LP cut-offs move per region and over the season. A
 *    percentage toward them would be invented, so progress toward those
 *    targets is reported as "indeterminate" (with LP gained still shown).
 */
import type {
  LeagueRank,
  RankDivision,
  RankTier,
  SourcedRank,
} from "./riot.types";

export const DIVISION_TIERS: RankTier[] = [
  "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND",
];
export const APEX_TIERS: RankTier[] = ["MASTER", "GRANDMASTER", "CHALLENGER"];
export const ALL_TIERS: RankTier[] = [...DIVISION_TIERS, ...APEX_TIERS];
export const DIVISIONS: RankDivision[] = ["IV", "III", "II", "I"];

const LP_PER_DIVISION = 100;
const LP_PER_TIER = LP_PER_DIVISION * DIVISIONS.length;
export const APEX_BASE_SCORE = DIVISION_TIERS.length * LP_PER_TIER; // 2800

/** A rank snapshot older than this is shown as stale. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isApexTier(tier: RankTier): boolean {
  return APEX_TIERS.includes(tier);
}

/** Parse loose input (Riot "DIAMOND"/"IV", catalog "diamond"/"iv"). */
export function normalizeRank(
  tier: unknown,
  division: unknown,
  lp: unknown = 0
): LeagueRank | null {
  if (typeof tier !== "string") return null;
  const t = tier.trim().toUpperCase() as RankTier;
  if (!ALL_TIERS.includes(t)) return null;
  const lpNum = typeof lp === "number" && Number.isFinite(lp) ? Math.max(0, Math.floor(lp)) : 0;
  if (isApexTier(t)) return { tier: t, division: null, lp: lpNum };
  if (typeof division !== "string") return null;
  const d = division.trim().toUpperCase() as RankDivision;
  if (!DIVISIONS.includes(d)) return null;
  return { tier: t, division: d, lp: Math.min(lpNum, LP_PER_DIVISION) };
}

export function rankToScore(rank: LeagueRank): number {
  if (isApexTier(rank.tier)) return APEX_BASE_SCORE + Math.max(0, rank.lp);
  const tierIndex = DIVISION_TIERS.indexOf(rank.tier);
  const divIndex = DIVISIONS.indexOf(rank.division as RankDivision);
  if (tierIndex < 0 || divIndex < 0) throw new Error("Invalid rank");
  return tierIndex * LP_PER_TIER + divIndex * LP_PER_DIVISION + Math.min(Math.max(rank.lp, 0), LP_PER_DIVISION);
}

/** Ordinal for comparing tier/division ignoring LP (apex tiers by tier). */
export function rankStep(rank: LeagueRank): number {
  if (isApexTier(rank.tier)) {
    return DIVISION_TIERS.length * DIVISIONS.length + APEX_TIERS.indexOf(rank.tier);
  }
  return DIVISION_TIERS.indexOf(rank.tier) * DIVISIONS.length + DIVISIONS.indexOf(rank.division!);
}

export function formatRank(rank: LeagueRank, withLp = true): string {
  const name = rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase();
  const base = rank.division ? `${name} ${rank.division}` : name;
  return withLp ? `${base} · ${rank.lp} LP` : base;
}

export type ProgressStatus =
  | "unavailable" // no start or no current rank
  | "invalid" // target is not above the starting rank
  | "in_progress"
  | "complete"
  | "indeterminate"; // apex target with no fixed LP threshold

export interface RankProgress {
  status: ProgressStatus;
  /** 0..100, only when it can be computed honestly. */
  percent: number | null;
  /** current - start, in ladder points (negative = demoted). */
  lpDelta: number | null;
  /** Remaining ladder points to target (null when unknown). */
  lpRemaining: number | null;
  /** Divisions/tiers moved since start (negative = demotion). */
  stepsDelta: number | null;
  direction: "up" | "down" | "flat" | null;
  /** Current is below the starting rank. */
  demoted: boolean;
  /** The current-rank snapshot is older than STALE_AFTER_MS. */
  stale: boolean;
  /** The starting LP was not known and 0 was assumed. */
  startLpAssumed: boolean;
}

export function computeRankProgress(input: {
  start: SourcedRank | null;
  current: SourcedRank | null;
  target: LeagueRank | null;
  now?: Date;
}): RankProgress {
  const now = input.now ?? new Date();
  const { start, current, target } = input;
  const stale =
    !!current?.at && current.source !== "order" && now.getTime() - current.at.getTime() > STALE_AFTER_MS;
  const empty: RankProgress = {
    status: "unavailable",
    percent: null,
    lpDelta: null,
    lpRemaining: null,
    stepsDelta: null,
    direction: null,
    demoted: false,
    stale,
    startLpAssumed: !!start?.lpAssumed,
  };
  if (!start || !target) return empty;

  const startScore = rankToScore(start);
  // Targets are a rank with no LP: "reach Diamond II" = Diamond II 0 LP.
  const targetScore = rankToScore({ ...target, lp: 0 });
  const apexBeyondMaster = target.tier === "GRANDMASTER" || target.tier === "CHALLENGER";

  if (!apexBeyondMaster && targetScore <= startScore) {
    return { ...empty, status: "invalid" };
  }
  if (!current) return empty;

  const currentScore = rankToScore(current);
  const lpDelta = currentScore - startScore;
  const stepsDelta = rankStep(current) - rankStep(start);
  const direction = lpDelta > 0 ? "up" : lpDelta < 0 ? "down" : "flat";
  const demoted = lpDelta < 0;
  const base = { ...empty, lpDelta, stepsDelta, direction, demoted } as RankProgress;

  if (apexBeyondMaster) {
    // Reached when Riot reports the tier itself; never inferred from LP.
    const reached = rankStep(current) >= rankStep({ tier: target.tier, division: null, lp: 0 });
    return reached
      ? { ...base, status: "complete", percent: 100, lpRemaining: 0 }
      : { ...base, status: "indeterminate", percent: null, lpRemaining: null };
  }

  if (currentScore >= targetScore) {
    return { ...base, status: "complete", percent: 100, lpRemaining: 0 };
  }
  const raw = ((currentScore - startScore) / (targetScore - startScore)) * 100;
  const percent = Math.max(0, Math.min(99, Math.floor(raw)));
  return { ...base, status: "in_progress", percent, lpRemaining: targetScore - currentScore };
}

/** Is a Riot observation recent enough to be authoritative? */
export function isFreshObservation(rank: SourcedRank | null, now: Date = new Date()): boolean {
  return !!rank && rank.source === "riot" && !!rank.at && now.getTime() - rank.at.getTime() <= STALE_AFTER_MS;
}

/** Win-count services (Win Boost): attributed wins vs. ordered wins. */
export function computeWinProgress(winsAttributed: number, winsOrdered: number | null) {
  if (!winsOrdered || winsOrdered <= 0) return { percent: null, remaining: null };
  const percent = Math.min(100, Math.floor((winsAttributed / winsOrdered) * 100));
  return { percent, remaining: Math.max(0, winsOrdered - winsAttributed) };
}
