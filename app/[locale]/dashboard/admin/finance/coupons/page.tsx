import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { listCouponsWithUsage } from "@/lib/pricing/coupon-admin.service";
import { gameServices } from "@/lib/catalog/game-services";
import { getGame } from "@/lib/catalog/games";
import { formatMoney } from "@/lib/money";
import { CouponCreateForm, CouponToggle } from "@/components/finance/CouponsAdmin";

export const dynamic = "force-dynamic";

const card = "rounded-lg border border-white/10 bg-white/5 p-4";
const th = "px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-zinc-400";
const td = "px-3 py-2 align-top";

export default async function AdminCouponsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const coupons = await listCouponsWithUsage();
  const services = gameServices.map((s) => ({
    gameSlug: s.gameSlug,
    serviceSlug: s.serviceSlug,
    label: `${getGame(s.gameSlug)?.name ?? s.gameSlug} · ${s.title ?? s.serviceSlug}`,
  }));
  const value = (c: (typeof coupons)[number]) =>
    c.type === "PERCENT" ? `${(c.percentBps ?? 0) / 100}%` : formatMoney(c.amount ?? 0, c.currency ?? "USD");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Discount codes</h1>
          <p className="text-sm text-zinc-400">
            Platform-funded: a code is capped at the platform fee of the order and never reduces what the booster earns.
          </p>
        </div>
        <Link href="/dashboard/admin/finance" className="rounded-md bg-white/10 px-3 py-1.5 text-sm">Back to finance</Link>
      </div>

      <section className={card}>
        <h2 className="mb-3 font-semibold">New code</h2>
        <CouponCreateForm services={services} />
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">Codes</h2>
        {coupons.length === 0 ? (
          <p className="text-sm text-zinc-400">No codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Value</th>
                  <th className={th}>Rules</th>
                  <th className={th}>Paid uses</th>
                  <th className={th}>Discount given</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} font-mono`}>{c.code}</td>
                    <td className={td}>{value(c)}</td>
                    <td className={`${td} text-xs text-zinc-400`}>
                      {[
                        c.maxRedemptions ? `max ${c.maxRedemptions} uses` : null,
                        `${c.perCustomerLimit}/customer`,
                        c.minSubtotal ? `min ${formatMoney(c.minSubtotal, c.currency ?? "USD")}` : null,
                        c.maxDiscount ? `cap ${formatMoney(c.maxDiscount, c.currency ?? "USD")}` : null,
                        c.serviceSlug ? `${c.gameSlug ?? ""} ${c.serviceSlug}`.trim() : c.gameSlug,
                        c.expiresAt ? `until ${c.expiresAt.toISOString().slice(0, 10)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td className={td}>{c.paidUses}</td>
                    <td className={td}>{c.totalDiscount ? formatMoney(c.totalDiscount, c.currency ?? "USD") : "—"}</td>
                    <td className={td}>
                      <span className={c.active ? "text-emerald-400" : "text-zinc-500"}>{c.active ? "Active" : "Inactive"}</span>
                    </td>
                    <td className={td}>
                      <CouponToggle id={c.id} active={c.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
