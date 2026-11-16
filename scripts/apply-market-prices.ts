/**
 * Apply the MARKET DEFAULT prices (lib/pricing/market-prices.ts) through the
 * normal admin path: createServicePriceVersion validates each price against
 * the catalog, RETIRES the current active version (e.g. the temporary test
 * price), creates the next ACTIVE version and writes one
 * SERVICE_PRICE_CREATED financialAuditLog row.
 *
 * Existing orders are not affected: each keeps the price snapshot it was paid
 * with. It never touches orders, payments, ledger, users or commission.
 *
 * Usage (from the project root):
 *   npx tsx scripts/apply-market-prices.ts                 # dry run, no writes
 *   npx tsx scripts/apply-market-prices.ts --list-admins   # admin ids (no emails)
 *   npx tsx scripts/apply-market-prices.ts --apply \
 *       --admin-id <ADMIN_USER_ID> --confirm-host <DATABASE HOSTNAME>
 */
import "dotenv/config";

(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main() {
  const { default: prisma } = await import("@/lib/prisma");
  const { allMarketPriceInputs } = await import("@/lib/pricing/market-prices");
  const { validateServicePriceAgainstCatalog } = await import("@/lib/pricing/price-config");
  const { createServicePriceVersion } = await import("@/lib/pricing/admin.service");

  const url = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset");
  console.log(`Target database: host=${url.hostname} db=${url.pathname.slice(1)}`);

  try {
    if (flag("--list-admins")) {
      const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, createdAt: true } });
      for (const a of admins) console.log(`  admin id=${a.id} created=${a.createdAt.toISOString().slice(0, 10)}`);
      return;
    }

    const inputs = allMarketPriceInputs();
    const active = await prisma.servicePrice.findMany({ where: { status: "ACTIVE" }, select: { gameSlug: true, serviceSlug: true, version: true } });
    const activeKeys = new Map(active.map((p) => [`${p.gameSlug}:${p.serviceSlug}`, p.version]));

    let invalid = 0;
    console.log(`\nPlanned market prices (${inputs.length}):`);
    for (const input of inputs) {
      const key = `${input.gameSlug}:${input.serviceSlug}`;
      const errors = validateServicePriceAgainstCatalog(input);
      if (errors.length) invalid++;
      const what =
        input.pricingModel === "RANK_STEPS"
          ? `per division: ${Object.entries(input.stepAmounts ?? {}).filter(([, v]) => v > 0).map(([t, v]) => `${t} ${money(v)}`).join(", ")}`
          : input.pricingModel === "PER_UNIT"
            ? `${money(input.unitAmount ?? 0)} per ${input.unitFieldKey}`
            : `fixed ${money(input.baseAmount)}`;
      const extras = Object.entries(input.optionPricing)
        .map(([id, a]) => `${id}=${a.type === "bps" ? `+${a.bps / 100}%` : a.amount ? money(a.amount) : "free"}`)
        .join(" ");
      const status = errors.length
        ? `INVALID: ${errors.join("; ")}`
        : activeKeys.has(key)
          ? `replace v${activeKeys.get(key)} -> v${activeKeys.get(key)! + 1}`
          : "create v1";
      console.log(`\n  ${key} [${status}]\n    ${what}\n    extras: ${extras || "none"}`);
    }
    if (invalid) throw new Error(`${invalid} price(s) are invalid against the catalog; nothing written.`);

    if (!flag("--apply")) {
      console.log("\nDry run: nothing was written. Re-run with --apply --admin-id <id> --confirm-host <host>.");
      return;
    }
    const adminId = value("--admin-id");
    if (!adminId) throw new Error("--apply needs --admin-id (see --list-admins).");
    if (value("--confirm-host") !== url.hostname) {
      throw new Error(`--confirm-host must equal the target host (${url.hostname}); nothing written.`);
    }

    let created = 0;
    for (const input of inputs) {
      const row = await createServicePriceVersion(adminId, input);
      created++;
      console.log(`  ${input.gameSlug}:${input.serviceSlug} -> v${row.version} (${row.id})`);
    }
    console.log(`\nDone: ${created} price version(s) created; previous versions retired.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
