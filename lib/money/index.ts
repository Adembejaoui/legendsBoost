/**
 * Money helpers. Every amount is an integer number of the currency's minor
 * unit (cents for EUR/USD, yen for JPY) paired with an ISO-4217 code.
 * Floating-point arithmetic is never used for money: percentages are basis
 * points (1 bps = 0.01 %) applied with integer arithmetic.
 *
 * Amounts are bounded (MAX_AMOUNT) so every intermediate product
 * (amount * bps <= 1e9 * 1e4 = 1e13) stays far below Number.MAX_SAFE_INTEGER.
 */

/** 10,000,000.00 in a 2-decimal currency. Larger orders are rejected. */
export const MAX_AMOUNT = 1_000_000_000;
export const BPS_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertAmount(amount: number, label = "amount"): number {
  if (!Number.isSafeInteger(amount)) throw new MoneyError(`${label} must be an integer number of minor units`);
  if (Math.abs(amount) > MAX_AMOUNT) throw new MoneyError(`${label} exceeds the supported maximum`);
  return amount;
}

export function assertBps(bps: number, label = "bps"): number {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new MoneyError(`${label} must be an integer between 0 and ${BPS_DENOMINATOR}`);
  }
  return bps;
}

/** Normalise and validate an ISO-4217 code ("eur" -> "EUR"). */
export function normalizeCurrency(currency: string): string {
  const c = String(currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new MoneyError("Currency must be a 3-letter ISO-4217 code");
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: c });
  } catch {
    throw new MoneyError(`Unknown currency ${c}`);
  }
  return c;
}

/** Number of minor-unit digits for a currency (EUR 2, JPY 0, KWD 3). */
export function currencyExponent(currency: string): number {
  const c = normalizeCurrency(currency);
  return new Intl.NumberFormat("en", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Exact decimal string for an amount, e.g. (4999, "EUR") -> "49.99". */
export function toDecimalString(amount: number, currency: string): string {
  assertAmount(amount);
  const exp = currencyExponent(currency);
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(exp + 1, "0");
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const frac = exp === 0 ? "" : `.${digits.slice(-exp)}`;
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/**
 * Parse a decimal string typed by an admin into minor units without floats.
 * ("49.99", "EUR") -> 4999. More fraction digits than the currency allows is
 * an error, not a rounding.
 */
export function parseDecimalToMinor(input: string, currency: string): number {
  const exp = currencyExponent(currency);
  const s = String(input ?? "").trim();
  const m = /^(\d{1,10})(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError("Amount must be a non-negative decimal number");
  const frac = m[2] ?? "";
  if (frac.length > exp) throw new MoneyError(`At most ${exp} decimal places for ${normalizeCurrency(currency)}`);
  const amount = Number(m[1]) * 10 ** exp + Number(frac.padEnd(exp, "0") || "0");
  return assertAmount(amount);
}

/** Display only (never feed the result back into arithmetic). */
export function formatMoney(amount: number, currency: string, locale = "en"): string {
  const c = normalizeCurrency(currency);
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency: c });
  // Intl formats decimal strings exactly; the cast covers older lib typings.
  return fmt.format(toDecimalString(amount, c) as unknown as number);
}

/** floor(amount * bps / 10000), for non-negative amounts. */
export function bpsOfFloor(amount: number, bps: number): number {
  assertAmount(amount);
  assertBps(bps);
  if (amount < 0) throw new MoneyError("bpsOfFloor expects a non-negative amount");
  return Math.floor((amount * bps) / BPS_DENOMINATOR);
}

/** Round-half-up percentage, for customer-facing surcharges. */
export function bpsOfRounded(amount: number, bps: number): number {
  assertAmount(amount);
  assertBps(bps);
  if (amount < 0) throw new MoneyError("bpsOfRounded expects a non-negative amount");
  return Math.floor((amount * bps + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

export interface CommissionSplit {
  platformFeeBps: number;
  boosterShareBps: number;
  platformFeeAmount: number;
  boosterShareAmount: number;
}

/**
 * Split a commission base between booster and platform.
 * boosterShare = floor(base * boosterBps / 10000); platform = base - booster.
 * The two parts always sum to the base exactly; any rounding remainder (at
 * most one minor unit) goes to the platform, never taken from the booster
 * beyond the floor.
 */
export function splitCommission(base: number, policy: { platformFeeBps: number; boosterShareBps: number }): CommissionSplit {
  assertAmount(base, "commission base");
  if (base < 0) throw new MoneyError("Commission base cannot be negative");
  assertBps(policy.platformFeeBps, "platformFeeBps");
  assertBps(policy.boosterShareBps, "boosterShareBps");
  if (policy.platformFeeBps + policy.boosterShareBps !== BPS_DENOMINATOR) {
    throw new MoneyError("Commission policy must sum to 100%");
  }
  const boosterShareAmount = bpsOfFloor(base, policy.boosterShareBps);
  return {
    platformFeeBps: policy.platformFeeBps,
    boosterShareBps: policy.boosterShareBps,
    platformFeeAmount: base - boosterShareAmount,
    boosterShareAmount,
  };
}

/**
 * Split `total` across `weights` proportionally with the largest-remainder
 * method: parts are integers, non-negative, and sum to `total` exactly.
 * Ties are broken by the earlier index, so results are deterministic.
 */
export function allocateProRata(total: number, weights: number[]): number[] {
  assertAmount(total);
  if (total < 0) throw new MoneyError("Cannot allocate a negative total");
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new MoneyError("Weights must be non-negative integers");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    if (total === 0) return weights.map(() => 0);
    throw new MoneyError("Cannot allocate across zero weights");
  }
  // total * weight can exceed 2^53 (amount x amount): use BigInt.
  const T = BigInt(total);
  const S = BigInt(sum);
  const raw = weights.map((w) => Number((T * BigInt(w)) / S));
  let remainder = total - raw.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (T * BigInt(w)) % S }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (remainder <= 0) break;
    raw[i] += 1;
    remainder -= 1;
  }
  return raw;
}

/**
 * Cumulative reversal: how much of `allocated` to reverse when the
 * cumulative reversed base reaches `cumulativeBase` of `originalBase`.
 * Using cumulative figures (instead of rounding each partial refund on its
 * own) guarantees that a sequence of partial refunds summing to the full
 * amount reverses exactly `allocated`, with no drift.
 */
export function cumulativeShare(allocated: number, cumulativeBase: number, originalBase: number): number {
  assertAmount(allocated);
  assertAmount(cumulativeBase);
  assertAmount(originalBase);
  if (originalBase <= 0) return 0;
  const capped = Math.min(Math.max(cumulativeBase, 0), originalBase);
  // allocated * capped can exceed 2^53: use BigInt (floor division).
  return Number((BigInt(allocated) * BigInt(capped)) / BigInt(originalBase));
}
