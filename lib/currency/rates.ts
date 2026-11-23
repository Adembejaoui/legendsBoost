// Server-only module.
/**
 * Daily exchange rates for pricing in the customer's currency (2026-11-23).
 *
 * Rates come from the European Central Bank through Frankfurter (free, no
 * key; only the list of currencies is sent). They are stored in the
 * `appConfig` row `fx_rates` and refreshed at most once a day, on the first
 * quote that needs them, or by the `fx-rates` job. If the source is down,
 * stored rates are used for up to 7 days; after that only a service's own
 * currency can be bought, so a customer is never charged on a stale rate.
 *
 * Conversion happens on the admin price list BEFORE the price is calculated
 * (convertPriceConfig), so every amount, the booster share and the
 * platform fee are whole minor units in the charged currency.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { MAX_AMOUNT } from "@/lib/money";
import type { PriceAdjustment, ServicePriceConfig } from "@/lib/pricing/price-config";
import { SITE_CURRENCIES } from "./currencies";

export const FX_CONFIG_KEY = "fx_rates";
const FX_BASE = "USD";
const REFRESH_AFTER_MS = 24 * 60 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const MEMORY_MS = 10 * 60_000;
const SOURCE_URL = `https://api.frankfurter.dev/v1/latest?base=${FX_BASE}&symbols=${SITE_CURRENCIES.filter((c) => c !== FX_BASE).join(",")}`;

const fxSchema = z.object({
  base: z.literal(FX_BASE),
  /** Units of each currency for 1 USD (USD itself is 1). */
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().min(0.01).max(1000)),
  /** Date of the rates (ECB publication day). */
  date: z.string(),
  fetchedAt: z.string(),
});
export type FxRates = z.infer<typeof fxSchema>;

let memory: { at: number; value: FxRates | null } | null = null;

export function clearFxCache() {
  memory = null;
}

async function readStored(): Promise<FxRates | null> {
  try {
    const row = await prisma.appConfig.findUnique({ where: { key: FX_CONFIG_KEY }, select: { value: true } });
    const parsed = fxSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Download today's rates and store them. Returns null when the source fails. */
export async function refreshFxRates(fetchImpl: typeof fetch = fetch): Promise<FxRates | null> {
  try {
    const res = await fetchImpl(SOURCE_URL, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { base?: string; date?: string; rates?: Record<string, number> };
    const value = fxSchema.parse({ base: body.base, rates: { ...body.rates, [FX_BASE]: 1 }, date: body.date ?? "", fetchedAt: new Date().toISOString() });
    for (const c of SITE_CURRENCIES) if (!(c in value.rates)) throw new Error(`missing ${c}`);
    await prisma.appConfig.upsert({
      where: { key: FX_CONFIG_KEY },
      create: { key: FX_CONFIG_KEY, value },
      update: { value },
    });
    memory = { at: Date.now(), value };
    return value;
  } catch (e) {
    logger.warn("Exchange rates refresh failed", { error: e instanceof Error ? e.message : "unknown" });
    return null;
  }
}

/** Current rates (refreshed when older than a day), or null when none can be trusted. */
export async function getFxRates(now = Date.now()): Promise<FxRates | null> {
  if (memory && now - memory.at < MEMORY_MS) return memory.value;
  let value = await readStored();
  const age = value ? now - Date.parse(value.fetchedAt) : Infinity;
  if (age > REFRESH_AFTER_MS) value = (await refreshFxRates()) ?? value;
  const usable = value && now - Date.parse(value.fetchedAt) <= MAX_AGE_MS ? value : null;
  memory = { at: now, value: usable };
  return usable;
}

/**
 * Multiplier from one currency to another (1 for the same currency), with
 * the admin's exchange margin (config fx_markup_bps) on real conversions.
 * Null when a rate is missing.
 */
export function conversionFactor(from: string, to: string, fx: FxRates | null, markupBps = 0): number | null {
  if (from === to) return 1;
  const a = fx?.rates[from];
  const b = fx?.rates[to];
  if (!a || !b) return null;
  return (b / a) * (1 + markupBps / 10_000);
}

const conv = (amount: number, factor: number) => Math.min(MAX_AMOUNT, Math.round(amount * factor));

function convertAdjustment(a: PriceAdjustment, factor: number): PriceAdjustment {
  return a.type === "fixed" ? { type: "fixed", amount: conv(a.amount, factor) } : a;
}

/** The admin price list expressed in another currency (percentages unchanged). */
export function convertPriceConfig(price: ServicePriceConfig, to: string, factor: number): ServicePriceConfig {
  if (price.currency === to) return price;
  const mapValues = <T, U>(o: Record<string, T>, f: (v: T) => U) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
  return {
    ...price,
    currency: to,
    baseAmount: conv(price.baseAmount, factor),
    stepAmounts: price.stepAmounts ? mapValues(price.stepAmounts, (v) => conv(v, factor)) : null,
    unitAmount: price.unitAmount == null ? null : conv(price.unitAmount, factor),
    optionPricing: mapValues(price.optionPricing, (a) => convertAdjustment(a, factor)),
    modePricing: mapValues(price.modePricing, (a) => convertAdjustment(a, factor)),
  };
}

export interface PriceInCurrency {
  price: ServicePriceConfig;
  /** Present when the price was converted (stored with the order). */
  fx: { from: string; to: string; rate: number; date: string } | null;
}

/**
 * The price list in the requested currency, or in its own currency when no
 * currency is requested. Null when the conversion is not possible right now.
 */
export async function priceInCurrency(price: ServicePriceConfig, to: string | undefined): Promise<PriceInCurrency | null> {
  if (!to || to === price.currency) return { price, fx: null };
  const fx = await getFxRates();
  const factor = conversionFactor(price.currency, to, fx, await getConfig("fx_markup_bps"));
  if (factor === null || !fx) return null;
  return { price: convertPriceConfig(price, to, factor), fx: { from: price.currency, to, rate: Number(factor.toFixed(6)), date: fx.date } };
}
