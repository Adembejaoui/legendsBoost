import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { getOrderEligibility } from "@/lib/orders/order-eligibility";
import { getActiveCommissionPolicy } from "@/lib/pricing/service";
import { parseServicePriceRow, TEMPORARY_PRICE_NOTE_PREFIX } from "@/lib/pricing/price-config";
import { toDecimalString } from "@/lib/money";
import { unitStepKeys } from "@/lib/pricing/units";
import { CommissionForm, ServicePriceForm, type PriceFormService } from "@/components/finance/PricingAdmin";

export const dynamic = "force-dynamic";

export default async function AdminPricingPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const [rows, policy, history] = await Promise.all([
    prisma.servicePrice.findMany({ where: { status: "ACTIVE" } }),
    getActiveCommissionPolicy(),
    prisma.commissionPolicy.findMany({ orderBy: { effectiveFrom: "desc" }, take: 10 }),
  ]);
  const active = new Map(rows.map((r) => [`${r.gameSlug}:${r.serviceSlug}`, parseServicePriceRow(r)]));
  // Notes are stored only in the creation audit row (no schema change).
  const audits = rows.length
    ? await prisma.financialAuditLog.findMany({
        where: { entityType: "servicePrice", action: "SERVICE_PRICE_CREATED", entityId: { in: rows.map((r) => r.id) } },
        select: { entityId: true, details: true },
      })
    : [];
  const temporaryIds = new Set(
    audits
      .filter((a) => {
        const note = (a.details as { input?: { note?: unknown } } | null)?.input?.note;
        return typeof note === "string" && note.startsWith(TEMPORARY_PRICE_NOTE_PREFIX);
      })
      .map((a) => a.entityId)
  );

  const services: (PriceFormService & {
    sellable: boolean;
    reason: string | null;
    version: number | null;
    temporary: boolean;
    testModeOnly: boolean;
  })[] = gameServices.map((o) => {
    const checkout = getCheckoutConfig(o.gameSlug, o.serviceSlug);
    const eligibility = getOrderEligibility(o.gameSlug, o.serviceSlug);
    const price = active.get(`${o.gameSlug}:${o.serviceSlug}`) ?? null;
    const dec = (n: number | null | undefined) => (n == null || !price ? "" : toDecimalString(n, price.currency));
    const adj = (m: Record<string, { type: string; amount?: number; bps?: number }>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { type: v.type, value: v.type === "fixed" ? dec(v.amount ?? 0) : String((v.bps ?? 0) / 100) }]));
    return {
      gameSlug: o.gameSlug,
      serviceSlug: o.serviceSlug,
      title: o.title ?? o.serviceSlug,
      rankTiers: o.rankSystemId && o.fields.some((f) => f.key === "targetRank") ? (getRankSystem(o.rankSystemId)?.tiers ?? []).map((t) => ({ id: t.id, name: t.name })) : null,
      numberFields: [
        ...o.fields.filter((f) => f.type === "number").map((f) => ({ key: f.key, label: f.label })),
        // Champion Mastery: price per level gained (lib/pricing/units.ts).
        ...(o.fields.some((f) => f.key === "currentLevel") && o.fields.some((f) => f.key === "targetLevel")
          ? [{ key: "range:currentLevel:targetLevel", label: "Levels gained" }]
          : []),
      ],
      // Optional unit price per current-rank tier or per starting level.
      unitSteps: Object.fromEntries(
        [...o.fields.filter((f) => f.type === "number").map((f) => f.key), "range:currentLevel:targetLevel"].flatMap((key) => {
          const ids = unitStepKeys(key, o.fields, (id) => (getRankSystem(id)?.tiers ?? []).map((t) => t.id));
          if (!ids) return [];
          const tiers = new Map(
            o.fields.flatMap((f) => (f.type === "rank-picker" ? (getRankSystem(f.rankSystemId)?.tiers ?? []).map((t) => [t.id, t.name] as const) : []))
          );
          return [[key, ids.map((id) => ({ id, name: tiers.get(id) ?? `Level ${id} -> ${Number(id) + 1}` }))]];
        })
      ),
      options: (checkout?.options ?? []).filter((x) => x.enabled).map((x) => ({ id: x.id, label: x.label })),
      modes: (checkout?.modes ?? []).filter((m) => m.enabled).map((m) => ({ id: m.id, label: m.label })),
      active: price
        ? {
            currency: price.currency,
            pricingModel: price.pricingModel,
            baseAmount: dec(price.baseAmount),
            unitFieldKey: price.unitFieldKey,
            unitAmount: price.unitAmount != null ? dec(price.unitAmount) : null,
            stepAmounts: Object.fromEntries(Object.entries(price.stepAmounts ?? {}).map(([k, v]) => [k, dec(v)])),
            optionPricing: adj(price.optionPricing as never),
            modePricing: adj(price.modePricing as never),
          }
        : null,
      sellable: eligibility.ok && price !== null,
      reason: !eligibility.ok
        ? "Catalog: not orderable (publication flags, or compliance review pending while Stripe is not in test mode)"
        : price
          ? null
          : "No active price",
      version: price?.version ?? null,
      temporary: price !== null && temporaryIds.has(price.id),
      testModeOnly: eligibility.ok && eligibility.complianceWaivedForTestMode,
    };
  });

  return (
    <div className="max-w-5xl text-white">
      <Link href="/dashboard/admin/finance" className="text-sm text-zinc-400 underline">← Finance</Link>
      <h1 className="mt-2 text-2xl font-bold">Pricing &amp; commission</h1>
      <p className="mt-1 text-sm text-zinc-400">
        A service is purchasable only when the catalog enables live ordering <em>and</em> it has an active price. Saving creates a new
        price version; existing orders keep the price they were created with.
      </p>

      <section className="mt-6 rounded-xl border border-white/10 bg-white/3 p-4">
        <h2 className="text-lg font-semibold">Commission</h2>
        <p className="mb-3 text-sm text-zinc-400">
          In force: {policy ? `${policy.platformFeeBps / 100}% platform / ${policy.boosterShareBps / 100}% booster` : "none (payments disabled)"}.
          History: {history.map((h) => `${h.platformFeeBps / 100}% from ${h.effectiveFrom.toISOString().slice(0, 10)}`).join(", ")}.
        </p>
        <CommissionForm currentPlatformBps={policy?.platformFeeBps ?? null} />
      </section>

      {services.map((s) => (
        <section key={`${s.gameSlug}:${s.serviceSlug}`} className="mt-6 rounded-xl border border-white/10 bg-white/3 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{s.gameSlug} · {s.title}</h2>
            <div className="flex flex-wrap gap-2">
              {s.temporary ? (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">Temporary price: replace before launch</span>
              ) : null}
              {s.testModeOnly ? (
                <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs text-sky-200">Compliance pending: Stripe test mode only</span>
              ) : null}
              <span className={`rounded px-2 py-0.5 text-xs ${s.sellable ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-zinc-300"}`}>
                {s.sellable ? `Purchasable (price v${s.version})` : `Not purchasable: ${s.reason}`}
              </span>
            </div>
          </div>
          <ServicePriceForm service={s} />
        </section>
      ))}
    </div>
  );
}
