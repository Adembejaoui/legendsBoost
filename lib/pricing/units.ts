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
