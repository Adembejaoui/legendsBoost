/**
 * Shared numeric rank scale [registry F1]. PURE: no I/O.
 *
 * One integer per rank position so ranks can be compared, filtered (booster
 * rank ceiling, Phase 3) and stored (`start/target_rank_value`):
 *  - divisional tiers: one step per division, lowest first
 *    (LoL: Iron IV = 0, Iron I = 3, Gold I = 15, Diamond IV = 24, Diamond I = 27);
 *  - apex tiers (no divisions): the first apex tier follows the last division
 *    (LoL Master = 28) and each further apex tier adds APEX_STEP
 *    (Grandmaster 32, Challenger 36 if a rank system defines them).
 *
 * This is NOT a progress measure and never an MMR: progress uses
 * progressPoints() (Phase 5), which includes LP.
 */
import { getRankSystem } from "@/lib/catalog/rank-systems";
import type { RankSelection } from "@/types/catalog";

export const APEX_STEP = 4;

export interface RankPosition {
  tierId: string;
  divisionId: string | null;
  value: number;
}

/** Every position of a rank system with its value, lowest first. */
export function rankScale(rankSystemId: string): RankPosition[] {
  const system = getRankSystem(rankSystemId);
  if (!system) return [];
  const tiers = [...system.tiers].sort((a, b) => a.order - b.order);
  const out: RankPosition[] = [];
  let next = 0;
  let apexSeen = false;
  for (const t of tiers) {
    if (t.divisions && t.divisions.length > 0) {
      for (const d of t.divisions) out.push({ tierId: t.id, divisionId: d.id, value: next++ });
    } else {
      const value = apexSeen ? next - 1 + APEX_STEP : next;
      out.push({ tierId: t.id, divisionId: null, value });
      next = value + 1;
      apexSeen = true;
    }
  }
  return out;
}

/** Numeric value of a rank, or null if it is not a valid position of the system. */
export function rankValue(rankSystemId: string, rank: RankSelection | null | undefined): number | null {
  if (!rank) return null;
  const division = rank.divisionId ?? null;
  const pos = rankScale(rankSystemId).find((p) => p.tierId === rank.tierId && p.divisionId === division);
  return pos ? pos.value : null;
}

/** <0 if a is lower, 0 if equal, >0 if a is higher. Throws on invalid ranks. */
export function compareRanks(rankSystemId: string, a: RankSelection, b: RankSelection): number {
  const va = rankValue(rankSystemId, a);
  const vb = rankValue(rankSystemId, b);
  if (va === null || vb === null) throw new Error("compareRanks: invalid rank");
  return va - vb;
}

/** The next rank up, or null at the top of the ladder. */
export function nextRank(rankSystemId: string, rank: RankSelection): RankSelection | null {
  const scale = rankScale(rankSystemId);
  const i = scale.findIndex((p) => p.tierId === rank.tierId && p.divisionId === (rank.divisionId ?? null));
  if (i < 0) throw new Error("nextRank: invalid rank");
  const n = scale[i + 1];
  return n ? { tierId: n.tierId, divisionId: n.divisionId } : null;
}
