/**
 * How many priced units a configuration has (PER_UNIT pricing).
 *
 *   unitFieldKey "wins"                          -> the number in field "wins"
 *   unitFieldKey "range:currentLevel:targetLevel" -> targetLevel - currentLevel
 *     (Champion Mastery, client PDFs 2026-11-19: price per level gained)
 */
import type { ConfigField } from "@/types/catalog";

export type UnitsResult = { ok: true; units: number } | { ok: false; reason: string };

export function parseRangeKey(unitFieldKey: string): { from: string; to: string } | null {
  const m = /^range:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(unitFieldKey);
  return m ? { from: m[1], to: m[2] } : null;
}

/** The numeric fields a unit key needs (validation of an admin price). */
export function unitKeyFields(unitFieldKey: string): string[] {
  const range = parseRangeKey(unitFieldKey);
  return range ? [range.from, range.to] : [unitFieldKey];
}

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function unitsFor(unitFieldKey: string, configuration: Record<string, unknown>, fields: ConfigField[]): UnitsResult {
  const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const range = parseRangeKey(unitFieldKey);
  if (range) {
    const from = int(configuration[range.from]);
    const to = int(configuration[range.to]);
    if (from === null) return { ok: false, reason: `Enter a value for "${label(range.from)}" to calculate the price.` };
    if (to === null) return { ok: false, reason: `Enter a value for "${label(range.to)}" to calculate the price.` };
    if (to <= from) return { ok: false, reason: `${label(range.to)} must be above ${label(range.from)}.` };
    return { ok: true, units: to - from };
  }
  const units = int(configuration[unitFieldKey]);
  if (units === null || units < 1) return { ok: false, reason: `Enter a value for "${label(unitFieldKey)}" to calculate the price.` };
  return { ok: true, units };
}

/**
 * Optional per-step unit prices for PER_UNIT services (client 2026-11-25,
 * matched to market prices): the price of one unit depends on where the
 * order starts.
 *   - "wins" / "placementsRemaining" with a current-rank field: keyed by the
 *     tier of the current rank ("gold" -> price of one win in Gold).
 *   - "range:currentLevel:targetLevel": keyed by the level a step starts at
 *     ("4" -> price of Level 4 -> 5).
 * A key missing from the table falls back to the flat unitAmount.
 */
export function unitStepKeys(unitFieldKey: string, fields: ConfigField[], rankTierIds: (systemId: string) => string[]): string[] | null {
  const range = parseRangeKey(unitFieldKey);
  if (range) {
    const from = fields.find((f) => f.key === range.from);
    const to = fields.find((f) => f.key === range.to);
    if (from?.type !== "number" || to?.type !== "number") return null;
    const min = from.min ?? 1;
    const max = (to.max ?? from.max ?? min) - 1;
    const keys: string[] = [];
    for (let l = min; l <= max; l++) keys.push(String(l));
    return keys;
  }
  const current = fields.find((f) => f.key === "currentRank");
  if (current?.type !== "rank-picker") return null;
  return rankTierIds(current.rankSystemId);
}

/** Amount for the counted units, using per-step prices when present. */
export function unitsAmount(
  unitFieldKey: string,
  units: number,
  unitAmount: number,
  stepAmounts: Record<string, number> | null,
  configuration: Record<string, unknown>,
): number {
  if (!stepAmounts || Object.keys(stepAmounts).length === 0) return units * unitAmount;
  const range = parseRangeKey(unitFieldKey);
  if (range) {
    const from = int(configuration[range.from]);
    if (from === null) return units * unitAmount;
    let total = 0;
    for (let l = from; l < from + units; l++) total += stepAmounts[String(l)] ?? unitAmount;
    return total;
  }
  const rank = configuration.currentRank;
  const tierId = rank && typeof rank === "object" && "tierId" in rank ? String((rank as { tierId: unknown }).tierId) : null;
  return units * (tierId && stepAmounts[tierId] !== undefined ? stepAmounts[tierId] : unitAmount);
}
