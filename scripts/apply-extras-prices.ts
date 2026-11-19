/**
 * Re-price the extras and the Duo surcharge (client PDFs 2026-11-19) WITHOUT
 * touching the base / per-division / per-unit amounts an admin configured.
 *
 * For every ACTIVE ServicePrice it builds the next version through the normal
 * admin path (createServicePriceVersion: catalog validation, previous version
 * retired, audit row) with:
 *   - optionPricing: the catalog badge of every enabled option ("+25%" ->
 *     2500 bps of the service price; "Free" -> 0), from checkout-options.ts;
 *   - modePricing: Solo 0, Duo +50% (DUO_MODE_BPS);
 *   - every other amount copied from the active version.
 * Services whose prices would not change are skipped. Paid orders keep their
 * own price snapshot and are never affected.
 *
 * Usage (project root):
 *   npx tsx scripts/apply-extras-prices.ts                       # dry run
 *   npx tsx scripts/apply-extras-prices.ts --apply --admin-id <ADMIN_ID> --confirm-host <DB HOST>
 */
import "dotenv/config";

(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";

/** Services whose extras follow the client PDFs (more added page by page). */
const REPRICED_EXTRAS = new Set([
  "league-of-legends:rank-boost",
  "league-of-legends:win-boost",
  "league-of-legends:placement-boost",
  "league-of-legends:arena-boost",
  "league-of-legends:champion-mastery",
]);

/**
 * Services whose pricing model changes with the redesign (2026-11-20):
 * Champion Mastery goes from a fixed price to a price per level gained.
 * Amounts in USD cents; the admin can change them afterwards.
 */
const MODEL_OVERRIDES: Record<string, { pricingModel: "PER_UNIT"; unitFieldKey: string; unitAmount: number }> = {
  "league-of-legends:champion-mastery": { pricingModel: "PER_UNIT", unitFieldKey: "range:currentLevel:targetLevel", unitAmount: 600 },
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const { default: prisma } = await import("@/lib/prisma");
  const { getCheckoutConfig } = await import("@/lib/config/checkout-options");
  const { badgeToAdjustment, DUO_MODE_BPS } = await import("@/lib/pricing/market-prices");
  const { parseServicePriceRow, validateServicePriceAgainstCatalog } = await import("@/lib/pricing/price-config");
  const { createServicePriceVersion } = await import("@/lib/pricing/admin.service");
  type Input = import("@/lib/pricing/price-config").ServicePriceInput;

  const url = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset");
  console.log(`Target database: host=${url.hostname}`);
  const apply = flag("--apply");

  try {
    const rows = await prisma.servicePrice.findMany({ where: { status: "ACTIVE" } });
    const plans: Input[] = [];
    for (const row of rows) {
      const current = parseServicePriceRow(row);
      if (!current) {
        console.log(`  ! ${row.gameSlug}/${row.serviceSlug}: active price unreadable, skipped`);
        continue;
      }
      const checkout = getCheckoutConfig(row.gameSlug, row.serviceSlug);
      // Extras are re-priced only on the redesigned pages; other services keep
      // their current option prices and only get the new Duo rate.
      const optionPricing = REPRICED_EXTRAS.has(`${row.gameSlug}:${row.serviceSlug}`)
        ? Object.fromEntries((checkout?.options ?? []).filter((o) => o.enabled).map((o) => [o.id, badgeToAdjustment(o.badge)]))
        : current.optionPricing;
      const modePricing = Object.fromEntries(
        (checkout?.modes ?? [])
          .filter((m) => m.enabled)
          .map((m) => [m.id, m.id === "duo" ? { type: "bps" as const, bps: DUO_MODE_BPS } : { type: "fixed" as const, amount: 0 }])
      );
      const override = MODEL_OVERRIDES[`${row.gameSlug}:${row.serviceSlug}`];
      const modelChanges =
        !!override && (current.pricingModel !== override.pricingModel || current.unitFieldKey !== override.unitFieldKey);
      const input: Input = modelChanges
        ? {
            gameSlug: row.gameSlug,
            serviceSlug: row.serviceSlug,
            currency: current.currency,
            pricingModel: override.pricingModel,
            baseAmount: 0,
            unitFieldKey: override.unitFieldKey,
            unitAmount: override.unitAmount,
            optionPricing,
            modePricing,
            note: "Price per mastery level and extras (client PDFs 2026-11-19)",
          }
        : {
            gameSlug: row.gameSlug,
            serviceSlug: row.serviceSlug,
            currency: current.currency,
            pricingModel: current.pricingModel,
            baseAmount: current.baseAmount,
            ...(current.stepAmounts ? { stepAmounts: current.stepAmounts } : {}),
            ...(current.unitFieldKey ? { unitFieldKey: current.unitFieldKey } : {}),
            ...(current.unitAmount != null ? { unitAmount: current.unitAmount } : {}),
            optionPricing,
            modePricing,
            note: "Extras and Duo +50% (client PDFs 2026-11-19)",
          };
      const same =
        !modelChanges &&
        JSON.stringify(Object.entries(current.optionPricing).sort()) === JSON.stringify(Object.entries(optionPricing).sort()) &&
        JSON.stringify(Object.entries(current.modePricing).sort()) === JSON.stringify(Object.entries(modePricing).sort());
      const errors = validateServicePriceAgainstCatalog(input);
      const extras = Object.entries(optionPricing)
        .map(([id, a]) => `${id} ${a.type === "bps" ? `+${a.bps / 100}%` : "free"}`)
        .join(", ");
      console.log(
        `  ${same ? "=" : "→"} ${row.gameSlug}/${row.serviceSlug} v${row.version}${same ? " (unchanged)" : ""}${errors.length ? `  INVALID: ${errors.join("; ")}` : ""}`
      );
      if (!same) console.log(`      duo ${modePricing.duo ? "+50%" : "-"} | ${extras || "no extras"}`);
      if (modelChanges) console.log(`      model: ${current.pricingModel} -> ${input.pricingModel} (${input.unitFieldKey}, ${(input.unitAmount ?? 0) / 100} per unit)`);
      if (!same && !errors.length) plans.push(input);
    }

    console.log(`\n${plans.length} service(s) to re-price.`);
    if (!apply) {
      console.log("Dry run: nothing written. Add --apply --admin-id <id> --confirm-host <host> to write.");
      return;
    }
    const adminId = value("--admin-id");
    if (!adminId) throw new Error("--admin-id is required with --apply");
    if (value("--confirm-host") !== url.hostname) throw new Error(`--confirm-host must be ${url.hostname}`);
    for (const input of plans) {
      const created = await createServicePriceVersion(adminId, input);
      console.log(`  ✓ ${input.gameSlug}/${input.serviceSlug} -> v${created.version}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
