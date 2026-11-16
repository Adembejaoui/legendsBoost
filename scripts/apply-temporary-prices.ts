/**
 * Apply the owner-supplied TEMPORARY test prices (lib/pricing/temporary-prices.ts)
 * through the normal admin path: createServicePriceVersion validates each
 * price against the catalog, creates an ACTIVE versioned ServicePrice row and
 * writes one SERVICE_PRICE_CREATED financialAuditLog row (append-only),
 * marked TEMPORARY.
 *
 * It never touches orders, payments, ledger, snapshots, users or the
 * commission policy, and it never overwrites an existing active price
 * (services that already have one are skipped).
 *
 * Usage (from the project root):
 *   npx tsx scripts/apply-temporary-prices.ts                 # dry run, no writes
 *   npx tsx scripts/apply-temporary-prices.ts --list-admins   # admin ids (no emails)
 *   npx tsx scripts/apply-temporary-prices.ts --apply \
 *       --admin-id <ADMIN_USER_ID> --confirm-host <DATABASE HOSTNAME>
 */
import "dotenv/config";

// Quieter Prisma logging (no query echo); must be set before the client loads.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const { default: prisma } = await import("@/lib/prisma");
  const { allTemporaryPriceInputs, UNPRICED_SERVICES } = await import("@/lib/pricing/temporary-prices");
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

    const inputs = allTemporaryPriceInputs();
    const active = await prisma.servicePrice.findMany({ where: { status: "ACTIVE" }, select: { gameSlug: true, serviceSlug: true, version: true } });
    const activeKeys = new Map(active.map((p) => [`${p.gameSlug}:${p.serviceSlug}`, p.version]));

    let invalid = 0;
    console.log(`\nPlanned temporary prices (${inputs.length}):`);
    for (const input of inputs) {
      const key = `${input.gameSlug}:${input.serviceSlug}`;
      const errors = validateServicePriceAgainstCatalog(input);
      if (errors.length) invalid++;
      const status = errors.length ? `INVALID: ${errors.join("; ")}` : activeKeys.has(key) ? `SKIP (active v${activeKeys.get(key)} exists)` : "create v1";
      console.log(`  ${key.padEnd(38)} ${input.pricingModel.padEnd(10)} base=${input.baseAmount} ${input.currency}  -> ${status}`);
    }
    console.log(`\nLeft unpriced (no owner-supplied price): ${UNPRICED_SERVICES.join(", ") || "none"}`);
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
      const key = `${input.gameSlug}:${input.serviceSlug}`;
      if (activeKeys.has(key)) continue;
      const row = await createServicePriceVersion(adminId, input);
      created++;
      console.log(`  created ${key} v${row.version} (${row.id})`);
    }
    console.log(`\nDone: ${created} ServicePrice row(s) and ${created} audit row(s) created.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
