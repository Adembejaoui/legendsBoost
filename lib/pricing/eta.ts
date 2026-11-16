/**
 * Estimated completion time [registry F2]. PURE: no I/O.
 *
 * Shown in the configurator next to the price ("about 2 days"). It is an
 * estimate for the customer, never a promise in the terms and never part of
 * the price. Inputs come from config `eta_model` (lib/config), so the owner
 * can tune them as real completion data comes in.
 *
 *   rank boost  = sum of hours per division step (by the tier the step starts in)
 *   win boost   = wins x hoursPerWin;  placements = matches x hoursPerMatch
 *   other       = fixedHours
 *   then x lowLpGainFactor (low LP gain = more games), x duoFactor,
 *   x priorityFactor when "priority-completion" is selected.
 * Days assume `playHoursPerDay` of play per day.
 */
import type { RankSelection } from "@/types/catalog";
import { rankLadder } from "./engine";

export interface EtaModel {
  hoursPerDivisionByTier: Record<string, number>;
  defaultHoursPerDivision: number;
  hoursPerWin: number;
  hoursPerMatch: number;
  fixedHours: number;
  lowLpGainFactor: number;
  duoFactor: number;
  priorityFactor: number;
  playHoursPerDay: number;
}

export const DEFAULT_ETA_MODEL: EtaModel = {
  hoursPerDivisionByTier: { iron: 1.5, bronze: 1.5, silver: 2, gold: 2.5, platinum: 3, emerald: 4, diamond: 6, ascendant: 4.5, immortal: 7 },
  defaultHoursPerDivision: 3,
  hoursPerWin: 1,
  hoursPerMatch: 0.75,
  fixedHours: 12,
  lowLpGainFactor: 1.3,
  duoFactor: 1.2,
  priorityFactor: 0.75,
  playHoursPerDay: 8,
};

export const PRIORITY_OPTION_IDS = new Set(["priority-completion", "priority-scheduling"]);

export interface Estimate {
  hours: number;
  /** Short customer text, e.g. "about 6 hours", "about 2-3 days". */
  label: string;
}

export function estimateCompletion(
  model: EtaModel,
  input: {
    pricingModel: "RANK_STEPS" | "PER_UNIT" | "FIXED";
    rankSystemId?: string;
    configuration: Record<string, unknown>;
    unitFieldKey?: string | null;
    selectedMode: string | null;
    selectedOptions: string[];
  }
): Estimate | null {
  let hours: number;
  if (input.pricingModel === "RANK_STEPS") {
    const current = input.configuration.currentRank as RankSelection | undefined;
    const target = input.configuration.targetRank as RankSelection | undefined;
    if (!input.rankSystemId || !current || !target) return null;
    const ladder = rankLadder(input.rankSystemId);
    const pos = (s: RankSelection) => ladder.findIndex((p) => p.tierId === s.tierId && p.divisionId === (s.divisionId ?? null));
    const from = pos(current);
    const to = pos(target);
    if (from < 0 || to <= from) return null;
    hours = 0;
    for (let i = from; i < to; i++) hours += model.hoursPerDivisionByTier[ladder[i].tierId] ?? model.defaultHoursPerDivision;
    if (input.configuration.lpGain === "low") hours *= model.lowLpGainFactor;
  } else if (input.pricingModel === "PER_UNIT") {
    const units = input.unitFieldKey ? input.configuration[input.unitFieldKey] : undefined;
    if (typeof units !== "number" || units < 1) return null;
    hours = units * (input.unitFieldKey === "placementsRemaining" ? model.hoursPerMatch : model.hoursPerWin);
  } else {
    hours = model.fixedHours;
  }
  if (input.selectedMode === "duo") hours *= model.duoFactor;
  if (input.selectedOptions.some((o) => PRIORITY_OPTION_IDS.has(o))) hours *= model.priorityFactor;
  hours = Math.max(1, Math.round(hours * 10) / 10);
  return { hours, label: etaLabel(hours, model.playHoursPerDay) };
}

export function etaLabel(hours: number, playHoursPerDay: number): string {
  if (hours < playHoursPerDay) {
    const h = Math.max(1, Math.ceil(hours));
    return `about ${h} hour${h === 1 ? "" : "s"}`;
  }
  const days = hours / playHoursPerDay;
  const low = Math.max(1, Math.floor(days));
  const high = Math.ceil(days * 1.25);
  return low >= high ? `about ${low} day${low === 1 ? "" : "s"}` : `about ${low}-${high} days`;
}
