// Server-only module.
/**
 * Typed, admin-editable configuration [registry F18].
 *
 * Every [DECISION] value of the build plan (docs/BUILD_PLAN_PHASES.md,
 * section 3) is a key here with a code default and a zod schema. An admin
 * override lives in the `appConfig` table. Reads never fail: a missing,
 * invalid or unreadable value falls back to the default (and the table not
 * existing yet is fine). Writes are validated and audited.
 *
 * Add keys as phases introduce them; never read process.env for business
 * settings.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { DEFAULT_ETA_MODEL } from "@/lib/pricing/eta";

const bps = z.number().int().min(-10_000).max(10_000);
const posInt = z.number().int().positive();

export const CONFIG_SCHEMA = {
  // Pricing (Phase 1). Applied to rank-step lines by lib/pricing/engine.ts.
  lp_current_discount_bps: z.record(z.string(), bps),
  lp_gain_adjust_bps: z.record(z.string(), bps),
  // Estimated completion time shown with the quote (lib/pricing/eta.ts).
  eta_model: z
    .object({
      hoursPerDivisionByTier: z.record(z.string(), z.number().positive().max(200)),
      defaultHoursPerDivision: z.number().positive().max(200),
      hoursPerWin: z.number().positive().max(50),
      hoursPerMatch: z.number().positive().max(50),
      fixedHours: z.number().positive().max(1000),
      lowLpGainFactor: z.number().min(1).max(5),
      duoFactor: z.number().min(0.5).max(5),
      priorityFactor: z.number().min(0.1).max(1),
      playHoursPerDay: z.number().positive().max(24),
    })
    .strict(),
  // Checkout (paid-only orders).
  checkout_hold_ttl_min: posInt.max(24 * 60),
  // Riot tracker (Phase 5).
  riot_full_refresh_min: posInt.max(24 * 60),
  // Match and rank history kept this many days after an order ends (decision 2026-11-15: 15).
  match_retention_days: posInt.max(3650),
  tracker_provider: z.enum(["riot", "manual", "mock"]),
  // Booster onboarding (Phase 2): orders a TRIAL booster may claim.
  booster_trial_orders: posInt.max(50),
  // Booster pool (Phase 3): active orders per booster (override per
  // booster on BoosterProfile.maxConcurrentOrders).
  max_concurrent_orders: posInt.max(20),
  // SLA after a claim: warnings (automatic release: see stall_* below).
  contact_sla_min: posInt,
  start_sla_min: posInt,
  // Sealed bidding: the first bid of a round starts a window of this length.
  bid_window_sec: z.number().int().min(15).max(3600),
  // Lowest accepted bid, as a share of the payout ceiling. Default 7550:
  // bids go from the payout minus 24.5 % up to the payout, just above
  // "claim now" (minus 25 %) (client 2026-11-24).
  min_bid_bps: z.number().int().min(1000).max(10_000),
  // "Claim now" skips bidding at the payout ceiling minus this share.
  claim_now_discount_bps: z.number().int().min(0).max(9000),
  // Customer-chosen booster: exclusive offer length.
  preferred_booster_window_min: posInt.max(24 * 60),
  // Phase 6: a release within this many minutes of taking the order (and
  // before starting) goes straight back to the pool with no strike.
  release_grace_min: z.number().int().min(0).max(24 * 60),
  // Phase 6: no games and no chat for this long while in progress -> warning
  // to the booster and admins (no automatic release).
  inactivity_warn_hours: posInt.max(24 * 14),
  // Admin alerts (2026-11-24): a paid order nobody took, a completion waiting
  // for an admin, a support ticket waiting for a reply.
  unclaimed_alert_min: posInt.max(24 * 60),
  completion_wait_alert_hours: posInt.max(24 * 7),
  ticket_reply_alert_hours: posInt.max(24 * 7),
  // Customer cashback (2026-11-24): share of the paid amount credited when an
  // order is completed, the most of an order it can pay, and how long it lasts.
  cashback_enabled: z.boolean(),
  cashback_rate_bps: z.number().int().min(0).max(2000),
  cashback_max_order_bps: z.number().int().min(0).max(10_000),
  cashback_expiry_days: posInt.max(3650),
  // Phase 7: payouts are locked this long after a payout method change.
  payout_method_cooldown_hours: z.number().int().min(0).max(24 * 30),
  // Phase 6: published fine schedule (admins issue fines; amounts are the
  // suggested default, in minor units of EUR).
  fine_schedule: z
    .array(z.object({ code: z.string().regex(/^[A-Z_]{2,40}$/), label: z.string().min(2).max(120), amount: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(50),
  // Stalled orders (2026-11-24), measured from the booster's last activity
  // (message, game, rank update, session; a pause stops the clock):
  // sound alert when the customer has had no message this long after the
  // claim, email after stall_email_hours, final warning 1 h before
  // inactivity_release_hours, then the order is taken back and fined
  // (a share of the booster's payout; doubled on a 2nd release in 30 days,
  // doubled and claims blocked on the 3rd).
  stall_contact_alert_min: posInt.max(24 * 60),
  stall_email_hours: posInt.max(24 * 7),
  inactivity_release_hours: posInt.max(24 * 14),
  stall_fine_not_started_bps: z.number().int().min(0).max(10_000),
  stall_fine_in_progress_bps: z.number().int().min(0).max(10_000),
  // Completion with proof: the customer has this long to confirm or report a
  // problem before the order confirms itself (decision 2026-11-16).
  auto_confirm_hours: posInt.max(24 * 14),
  // Not enforced yet (Phase 7).
  earnings_hold_hours: z.number().int().min(0),
  min_payout_minor: z.number().int().min(0),
  // Multi-currency (2026-11-23): margin added to the exchange rate when an
  // order is priced in another currency than its price list (covers Stripe's
  // conversion fee). 0 = the plain daily rate.
  fx_markup_bps: z.number().int().min(0).max(1000),
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;
export type ConfigValue<K extends ConfigKey> = z.infer<(typeof CONFIG_SCHEMA)[K]>;

export const CONFIG_DEFAULTS: { [K in ConfigKey]: ConfigValue<K> } = {
  lp_current_discount_bps: { "0-20": 0, "21-40": 1500, "41-60": 3000, "61-80": 4500, "81-100": 6000 },
  lp_gain_adjust_bps: { low: 3000, normal: 0, high: -1000 },
  eta_model: DEFAULT_ETA_MODEL,
  checkout_hold_ttl_min: 60,
  riot_full_refresh_min: 5,
  match_retention_days: 15,
  tracker_provider: "riot",
  booster_trial_orders: 3,
  max_concurrent_orders: 1,
  contact_sla_min: 5,
  start_sla_min: 60,
  bid_window_sec: 60,
  min_bid_bps: 7550,
  claim_now_discount_bps: 2500,
  preferred_booster_window_min: 30,
  release_grace_min: 10,
  inactivity_warn_hours: 12,
  unclaimed_alert_min: 30,
  completion_wait_alert_hours: 4,
  ticket_reply_alert_hours: 12,
  cashback_enabled: true,
  cashback_rate_bps: 500,
  cashback_max_order_bps: 5000,
  cashback_expiry_days: 180,
  payout_method_cooldown_hours: 48,
  fine_schedule: [
    { code: "SLA_START", label: "Order not started in time", amount: 300 },
    { code: "LATE_RELEASE", label: "Order dropped after starting", amount: 1000 },
    { code: "CONTACT_LEAK", label: "Contact details shared or asked off-platform", amount: 1000 },
    { code: "CUSTOMER_REQUESTS", label: "Customer requests ignored (roles, champions, offline mode)", amount: 500 },
    { code: "ACCOUNT_CHANGES", label: "Account settings, email or currency changed", amount: 2000 },
    { code: "TOXIC_BEHAVIOUR", label: "Toxic behaviour or chat penalties on the account", amount: 1000 },
    { code: "OTHER", label: "Other rule breach (see note)", amount: 0 },
  ],
  stall_contact_alert_min: 45,
  stall_email_hours: 2,
  inactivity_release_hours: 24,
  stall_fine_not_started_bps: 1000,
  stall_fine_in_progress_bps: 2000,
  auto_confirm_hours: 72,
  earnings_hold_hours: 24,
  min_payout_minor: 2000,
  fx_markup_bps: 0,
};

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_SCHEMA, key);
}

const CACHE_MS = 30_000;
let cache: { at: number; rows: Map<string, unknown> } | null = null;

async function loadRows(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const rows = await prisma.appConfig.findMany({ select: { key: true, value: true } });
    cache = { at: Date.now(), rows: new Map(rows.map((r) => [r.key, r.value])) };
  } catch (e) {
    // Table not migrated yet or DB blip: defaults, retried after CACHE_MS.
    logger.warn("Config unavailable; using defaults", { error: e instanceof Error ? e.name : "unknown" });
    cache = { at: Date.now(), rows: new Map() };
  }
  return cache.rows;
}

/**
 * Read one key through the given client (use inside a transaction so the read
 * does not need a second connection). Falls back to the default.
 */
export async function getConfigIn<K extends ConfigKey>(
  db: { appConfig: { findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null> } },
  key: K
): Promise<ConfigValue<K>> {
  let row: { value: unknown } | null;
  try {
    row = await db.appConfig.findUnique({ where: { key }, select: { value: true } });
  } catch {
    // Same rule as getConfig: reads never fail (no table / no client) -> default.
    return CONFIG_DEFAULTS[key];
  }
  if (!row) return CONFIG_DEFAULTS[key];
  const parsed = CONFIG_SCHEMA[key].safeParse(row.value);
  return parsed.success ? (parsed.data as ConfigValue<K>) : CONFIG_DEFAULTS[key];
}

export function clearConfigCache() {
  cache = null;
}

export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigValue<K>> {
  const raw = (await loadRows()).get(key);
  if (raw === undefined) return CONFIG_DEFAULTS[key];
  const parsed = CONFIG_SCHEMA[key].safeParse(raw);
  if (!parsed.success) {
    logger.warn("Invalid config value; using default", { key });
    return CONFIG_DEFAULTS[key];
  }
  return parsed.data as ConfigValue<K>;
}

/** All keys with their effective value and whether it is an override (admin screen). */
export async function listConfig() {
  const rows = await loadRows();
  return (Object.keys(CONFIG_SCHEMA) as ConfigKey[]).map((key) => ({
    key,
    value: CONFIG_SCHEMA[key].safeParse(rows.get(key)).success ? rows.get(key) : CONFIG_DEFAULTS[key],
    default: CONFIG_DEFAULTS[key],
    overridden: rows.has(key) && CONFIG_SCHEMA[key].safeParse(rows.get(key)).success,
  }));
}

export class ConfigError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Admin override (validated, audited in the same transaction). `null` resets to the default. */
export async function setConfig(actorId: string, key: string, value: unknown): Promise<void> {
  if (!isConfigKey(key)) throw new ConfigError(`Unknown config key: ${key}`);
  if (value !== null) {
    const parsed = CONFIG_SCHEMA[key].safeParse(value);
    if (!parsed.success) throw new ConfigError(parsed.error.issues[0]?.message ?? "Invalid value");
    value = parsed.data;
  }
  await prisma.$transaction(async (tx) => {
    const before = await tx.appConfig.findUnique({ where: { key } });
    if (value === null) await tx.appConfig.deleteMany({ where: { key } });
    else await tx.appConfig.upsert({ where: { key }, create: { key, value: value as object, updatedById: actorId }, update: { value: value as object, updatedById: actorId } });
    await audit(
      { actorId, action: "CONFIG_CHANGED", entityType: "config", entityId: key, metadata: { before: before?.value ?? null, after: value } },
      tx
    );
  });
  clearConfigCache();
}
