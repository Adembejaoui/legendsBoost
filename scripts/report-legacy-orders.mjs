#!/usr/bin/env node
/**
 * Phase 1 legacy-order reconciliation report. READ-ONLY.
 *
 * Lists orders that existed before the marketplace payment gate and therefore
 * have no verified payment (order."paymentVerifiedAt" IS NULL, or the column
 * does not exist yet because the migration has not been applied). Nothing is
 * changed: the whole report runs inside a `BEGIN READ ONLY` transaction that
 * is rolled back.
 *
 * The connection string is NEVER taken from .env implicitly, so the report
 * cannot hit production by accident. Pass it explicitly:
 *
 *   LEGACY_REPORT_DATABASE_URL="postgresql://..." node scripts/report-legacy-orders.mjs
 *   LEGACY_REPORT_DATABASE_URL="..." node scripts/report-legacy-orders.mjs --json > legacy-orders.json
 *   ... --expect-host=db.<staging-ref>.supabase.co   (refuse to run against any other host)
 *
 * Safety: SET SESSION ... READ ONLY + BEGIN READ ONLY + ROLLBACK; only SELECT
 * statements; the URL and password are redacted from any error output.
 *
 * Output contains order ids, statuses, timestamps and booster/customer *ids*
 * only (no names, e-mails or credentials).
 */
import pg from "pg";

const url = process.env.LEGACY_REPORT_DATABASE_URL;
const asJson = process.argv.includes("--json");

if (!url) {
  console.error(
    "Set LEGACY_REPORT_DATABASE_URL explicitly (staging first). This script does not read DATABASE_URL from .env."
  );
  process.exit(2);
}

let host = "unknown";
let password = "";
try {
  const parsed = new URL(url);
  host = parsed.host; // host[:port] only; never user info
  password = decodeURIComponent(parsed.password || "");
} catch {
  console.error("LEGACY_REPORT_DATABASE_URL is not a valid URL.");
  process.exit(2);
}

// Optional safety: refuse to run unless the target host is the one you meant
// (e.g. --expect-host=db.<staging-ref>.supabase.co:5432).
const expectArg = process.argv.find((a) => a.startsWith("--expect-host="));
if (expectArg) {
  const expected = expectArg.slice("--expect-host=".length);
  if (expected !== host && expected !== host.split(":")[0]) {
    console.error(`Refusing to run: target host "${host}" does not match --expect-host "${expected}".`);
    process.exit(2);
  }
}

/** Remove the connection string and password from any text we print. */
function redact(text) {
  let out = String(text ?? "");
  if (url) out = out.split(url).join("<redacted-url>");
  if (password) out = out.split(password).join("<redacted>");
  return out.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "<redacted-url>");
}

/** Reconciliation categories, in priority order. */
const CATEGORIES = {
  IN_PROGRESS: "Booster is working on an order with no verified payment. Decide: verify payment out-of-band, or pause/cancel via admin.",
  PAUSED: "Paused order with no verified payment. Same decision as IN_PROGRESS.",
  PENDING: "Legacy PENDING order. Now hidden from the marketplace (no verified payment). Decide: contact customer, cancel, or keep until Stripe.",
  DRAFT: "Abandoned order. Cannot be republished without a verified payment.",
  COMPLETED: "Completed without any payment record. Must be excluded from (or explicitly reconciled before) future booster earnings.",
  AWAITING_PAYMENT: "Created after the gate. Expected to be unpaid; informational.",
  CANCELLED: "Cancelled. Informational; check whether any money was collected out-of-band.",
};

const client = new pg.Client({ connectionString: url, statement_timeout: 30000 });

async function main() {
  await client.connect();
  try {
    // Two independent read-only guards: the session default and the explicit
    // transaction mode. Any write attempt fails with SQLSTATE 25006.
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await client.query("BEGIN READ ONLY");

    const col = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'order' AND column_name = 'paymentVerifiedAt'`
    );
    const gateColumn = col.rowCount > 0;
    const paidExpr = gateColumn ? `o."paymentVerifiedAt"` : `NULL::timestamp`;

    const summary = await client.query(
      `SELECT o.status::text AS status,
              COUNT(*)::int AS total,
              COUNT(${paidExpr})::int AS payment_verified
         FROM "order" o
        GROUP BY o.status
        ORDER BY o.status`
    );

    const rows = await client.query(
      `SELECT o.id,
              o.status::text AS status,
              o."userId" AS customer_id,
              o."gameSlug" AS game,
              o."serviceSlug" AS service,
              o."createdAt" AS created_at,
              o."updatedAt" AS updated_at,
              o."completedAt" AS completed_at,
              (o.price IS NOT NULL) AS has_price,
              o.currency,
              ${paidExpr} AS payment_verified_at,
              (SELECT a."boosterId" FROM "orderBoosterAssignment" a
                WHERE a."activeOrderId" = o.id LIMIT 1) AS active_booster_id,
              (SELECT COUNT(*)::int FROM "orderBoosterAssignment" a
                WHERE a."orderId" = o.id) AS assignment_count,
              (SELECT COUNT(*)::int FROM "orderBoosterAssignment" a
                WHERE a."orderId" = o.id AND a.status = 'COMPLETED') AS completed_assignments
         FROM "order" o
        WHERE ${paidExpr} IS NULL
        ORDER BY o.status, o."createdAt"`
    );

    // In Phase 1 nothing sets paymentVerifiedAt, so any non-NULL value is an
    // anomaly (manual SQL) that must be investigated before Stripe ships.
    const anomalies = gateColumn
      ? (
          await client.query(
            `SELECT id, status::text AS status, "paymentVerifiedAt" AS payment_verified_at
               FROM "order" WHERE "paymentVerifiedAt" IS NOT NULL ORDER BY "paymentVerifiedAt"`
          )
        ).rows
      : [];

    await client.query("ROLLBACK");

    const byStatus = {};
    for (const r of rows.rows) (byStatus[r.status] ??= []).push(r);

    const report = {
      generatedAt: new Date().toISOString(),
      databaseHost: host,
      gateColumnPresent: gateColumn,
      summary: summary.rows,
      unverifiedOrders: Object.fromEntries(
        Object.keys(CATEGORIES)
          .filter((s) => byStatus[s]?.length)
          .map((s) => [s, { action: CATEGORIES[s], count: byStatus[s].length, orders: byStatus[s] }])
      ),
      anomaliesPaymentVerifiedAtSet: anomalies,
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Legacy order reconciliation report (read-only)`);
    console.log(`Database host: ${host}`);
    console.log(`paymentVerifiedAt column present: ${gateColumn ? "yes" : "NO (migration not applied yet)"}`);
    console.log(`\nOrders by status:`);
    console.table(summary.rows);
    for (const [status, group] of Object.entries(report.unverifiedOrders)) {
      console.log(`\n## ${status}: ${group.count} order(s) without verified payment`);
      console.log(`   Action: ${group.action}`);
      console.table(
        group.orders.map((o) => ({
          id: o.id,
          created: o.created_at?.toISOString?.() ?? o.created_at,
          activeBooster: o.active_booster_id ?? "",
          assignments: o.assignment_count,
          hasPrice: o.has_price,
        }))
      );
    }
    if (anomalies.length) {
      console.log(`\n!! ${anomalies.length} order(s) already have paymentVerifiedAt set. Nothing in Phase 1 sets it: investigate.`);
      console.table(anomalies);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Report failed:", redact(err?.message ?? err));
  process.exit(1);
});
