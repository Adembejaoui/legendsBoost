/**
 * LP-based price modifiers for rank boosts (LoL / TFT "LP", VALORANT "RR").
 *
 * Industry practice (GameBoost, Boosteria, Eloking; see
 * reports/Game boosting competitor features.md):
 *  - Current LP: an account already at 61-80 LP needs fewer games to finish
 *    its FIRST division, so that division is discounted.
 *  - LP gain per win: low gains mean more games for every division, so the
 *    division steps get a surcharge (high gains: a small discount).
 *
 * Amounts are basis points (1% = 100 bps). The engine applies them to the
 * rank-step lines only (never to the base price), as integer minor units.
 * Changing a value here changes NEW quotes only: every order keeps the
 * price snapshot it was paid with.
 */
import type { ConfigField } from "@/types/catalog";

export const CURRENT_LP_FIELD = "currentLp";
export const LP_GAIN_FIELD = "lpGain";

/** Discount on the first division step, by current LP bracket. */
export const CURRENT_LP_DISCOUNT_BPS: Record<string, number> = {
  "0-20": 0,
  "21-40": 1500,
  "41-60": 3000,
  "61-80": 4500,
  "81-100": 6000,
};

/** Adjustment on all division steps, by LP gain per win (+ = surcharge). */
export const LP_GAIN_ADJUSTMENT_BPS: Record<string, number> = {
  low: 3000,
  normal: 0,
  high: -1000,
};

const LP_BRACKETS = Object.keys(CURRENT_LP_DISCOUNT_BPS);

/**
 * The two configurator fields for a rank boost. `unit` is "LP" (LoL, TFT)
 * or "RR" (VALORANT); gain thresholds follow each game's usual values.
 */
export function lpFields(unit: "LP" | "RR"): ConfigField[] {
  const gain =
    unit === "RR"
      ? { low: "Low (under 15 RR)", normal: "Normal (15-22 RR)", high: "High (23+ RR)" }
      : { low: "Low (under 18 LP)", normal: "Normal (18-24 LP)", high: "High (25+ LP)" };
  return [
    {
      type: "select",
      key: CURRENT_LP_FIELD,
      label: `Current ${unit}`,
      description: `Your ${unit} in your current division. More ${unit} means fewer games, so a lower price.`,
      // Optional: older orders and API clients omit it (= no adjustment);
      // the configurator always sends its default.
      required: false,
      defaultValue: "0-20",
      options: LP_BRACKETS.map((b) => ({ label: `${b} ${unit}`, value: b })),
      visibleWhen: [{ key: "currentRank", operator: "present" as const }],
    },
    {
      type: "select",
      key: LP_GAIN_FIELD,
      label: `${unit} Gain`,
      description: `How much ${unit} you gain for a win. Low gains need more games.`,
      // Optional: older orders and API clients omit it (= no adjustment);
      // the configurator always sends its default.
      required: false,
      defaultValue: "normal",
      options: [
        { label: gain.normal, value: "normal" },
        { label: gain.low, value: "low" },
        { label: gain.high, value: "high" },
      ],
      visibleWhen: [{ key: "currentRank", operator: "present" as const }],
    },
  ] as ConfigField[];
}
