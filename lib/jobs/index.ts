// Server-only module.
/**
 * Scheduled jobs. Each job is idempotent and safe to run again; the lease
 * guarantees one run at a time. Triggered by Vercel Cron through
 * GET /api/cron/<name> (see vercel.json); add a job = add an entry here and
 * a schedule there.
 */
import { logger } from "@/lib/logger";
import { dispatchOutbox } from "@/lib/payments/outbox";
import { closeStaleCheckoutHolds } from "@/lib/payments/checkout.service";
import { closeDueBidding } from "@/lib/pool/service";
import { runInactivityWarnings, runSlaWarnings } from "@/lib/pool/sla";
import { purgeOldTrackerData } from "@/lib/services/games/league-of-legends/retention";
import { runProgressReminders } from "@/lib/orders/progress-updates.service";
import { acquireLease, releaseLease, type RawDb } from "./lease";
import { refreshFxRates } from "@/lib/currency/rates";

export interface JobDefinition {
  /** Lease length: longer than the job can ever take. */
  leaseMs: number;
  run: () => Promise<Record<string, unknown>>;
}

export const JOBS: Record<string, JobDefinition> = {
  /** Retry pending side effects (notifications, Stripe session expiry, fees). */
  "outbox-dispatch": {
    leaseMs: 4 * 60_000,
    run: async () => dispatchOutbox({ limit: 100 }),
  },
  /** Close unpaid checkout holds past their TTL (paid-only orders). */
  "close-stale-holds": {
    leaseMs: 4 * 60_000,
    run: async () => ({ closed: await closeStaleCheckoutHolds(null, new Date(), 100) }),
  },
  /** Award orders whose bidding window ended (also done lazily on pool reads). */
  "close-bidding": {
    leaseMs: 2 * 60_000,
    run: async () => closeDueBidding(),
  },
  /** Contact / start SLA warnings after a claim, inactivity and missing rank updates (warnings only). */
  "sla-warnings": {
    leaseMs: 4 * 60_000,
    run: async () => ({ ...(await runSlaWarnings()), ...(await runInactivityWarnings()), ...(await runProgressReminders()) }),
  },
  /** Removed 2026-11-22: an admin completes every order (kept so old cron calls answer). */
  "auto-confirm": {
    leaseMs: 60_000,
    run: async () => ({ skipped: "completions are decided by an admin" }),
  },
  /** Daily exchange rates for prices in EUR / GBP (also refreshed on demand by quotes). */
  "fx-rates": {
    leaseMs: 60_000,
    run: async () => {
      const fx = await refreshFxRates();
      return fx ? { date: fx.date, rates: fx.rates } : { error: "source unavailable, stored rates kept" };
    },
  },
  /** Delete match and rank history N days after an order ends (config match_retention_days). */
  "tracker-retention": {
    leaseMs: 10 * 60_000,
    run: async () => purgeOldTrackerData(),
  },
};

export type JobResult =
  | { status: "ran"; job: string; ms: number; result: Record<string, unknown> }
  | { status: "skipped"; job: string; reason: "locked" }
  | { status: "failed"; job: string; error: string };

export async function runJob(name: string, opts: { jobs?: Record<string, JobDefinition>; raw?: RawDb } = {}): Promise<JobResult> {
  const job = (opts.jobs ?? JOBS)[name];
  if (!job) throw new Error(`Unknown job: ${name}`);
  const runId = await acquireLease(name, job.leaseMs, opts.raw);
  if (!runId) return { status: "skipped", job: name, reason: "locked" };
  const started = Date.now();
  try {
    const result = await job.run();
    await releaseLease(name, runId, "ok", null, opts.raw);
    return { status: "ran", job: name, ms: Date.now() - started, result };
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 500) : "unknown";
    logger.error("Job failed", { job: name, error });
    await releaseLease(name, runId, "error", error, opts.raw).catch(() => {});
    return { status: "failed", job: name, error };
  }
}
