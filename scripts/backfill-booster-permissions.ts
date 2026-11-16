/**
 * Give boosters who were approved before Phase 2 their default rank ceilings:
 * one BoosterPermission per game in their application, capped at the peak rank
 * they declared. Boosters that already have a permission for a game keep it.
 *
 * It only creates BoosterPermission and BoosterEvent rows. It never changes a
 * booster's status, orders, payouts or users.
 *
 * Usage (from the project root):
 *   npx tsx scripts/backfill-booster-permissions.ts                 # dry run, no writes
 *   npx tsx scripts/backfill-booster-permissions.ts --apply --confirm-host <DATABASE HOSTNAME>
 */
import "dotenv/config";

(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const { default: prisma } = await import("@/lib/prisma");
  const { defaultPermissionsFromApplication, ensureDefaultPermissions } = await import("@/lib/boosters/permissions");

  const url = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset");
  console.log(`Target database: host=${url.hostname} db=${url.pathname.slice(1)}`);

  try {
    const boosters = await prisma.boosterProfile.findMany({
      where: { verificationStatus: { in: ["APPROVED", "TRIAL", "ON_BREAK", "SUSPENDED"] } },
      select: { id: true, verificationStatus: true, applicationData: true, permissions: { select: { gameSlug: true } } },
    });

    let planned = 0;
    let noApplication = 0;
    for (const b of boosters) {
      const have = new Set(b.permissions.map((p) => p.gameSlug));
      const missing = defaultPermissionsFromApplication(b.applicationData).filter((d) => !have.has(d.gameSlug));
      if (!b.applicationData) noApplication++;
      planned += missing.length;
      console.log(
        `  profile=${b.id} ${b.verificationStatus}: ${missing.length ? missing.map((d) => `${d.gameSlug} up to ${d.tierId} ${d.divisionId ?? ""}`.trim()).join(", ") : "nothing to add"}`
      );
    }
    console.log(`\n${boosters.length} booster(s); ${planned} permission(s) to create; ${noApplication} without application data (set by hand).`);

    if (!flag("--apply")) {
      console.log("\nDry run: nothing was written. Re-run with --apply --confirm-host <host>.");
      return;
    }
    if (value("--confirm-host") !== url.hostname) {
      throw new Error(`--confirm-host must equal the target host (${url.hostname}); nothing written.`);
    }

    let done = 0;
    for (const b of boosters) {
      await prisma.$transaction((tx) => ensureDefaultPermissions(tx, b.id, b.applicationData, null));
      done++;
    }
    const total = await prisma.boosterPermission.count();
    console.log(`\nDone: ${done} booster(s) processed; ${total} permission row(s) now exist.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
