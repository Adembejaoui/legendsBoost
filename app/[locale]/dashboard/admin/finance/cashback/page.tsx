import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { formatMoney } from "@/lib/money";
import { cashbackSettings } from "@/lib/cashback/service";
import { CashbackAdjustForm } from "@/components/finance/CashbackAdjustForm";

export const dynamic = "force-dynamic";

const card = "rounded-lg border border-white/10 bg-white/5 p-4";
const th = "px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-zinc-400";
const td = "px-3 py-2 align-top";

/** Admin: cashback owed to customers (ledger), recent activity and manual changes. */
export default async function AdminCashbackPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const [owed, byKind, recent, settings] = await Promise.all([
    prisma.financialTransaction.groupBy({ by: ["currency"], where: { account: "CUSTOMER_CREDIT" }, _sum: { amount: true } }),
    prisma.cashbackEntry.groupBy({ by: ["currency", "kind"], _sum: { amount: true } }),
    prisma.cashbackEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, kind: true, amount: true, currency: true, orderId: true, note: true, createdAt: true, user: { select: { email: true } } },
    }),
    cashbackSettings(),
  ]);
  const total = (currency: string, kind: string) => byKind.find((r) => r.currency === currency && r.kind === kind)?._sum.amount ?? 0;
  const currencies = [...new Set([...owed.map((o) => o.currency), ...byKind.map((r) => r.currency)])].sort();

  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cashback</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {settings.enabled ? "On" : "Off"} · {settings.rateBps / 100}% earned on completed orders · pays up to {settings.maxOrderBps / 100}% of an
            order · expires after {settings.expiryDays} days. Change these in{" "}
            <Link href="/dashboard/admin/settings" className="underline">
              Settings
            </Link>
            .
          </p>
        </div>
        <Link href="/dashboard/admin/finance" className="rounded-md bg-white/10 px-3 py-1.5 text-sm">
          Back to finance
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {currencies.length === 0 ? (
          <div className={card}>
            <p className="text-sm text-zinc-400">No cashback yet.</p>
          </div>
        ) : (
          currencies.map((c) => (
            <div key={c} className={card}>
              <p className="text-xs uppercase tracking-wide text-zinc-400">Owed to customers · {c}</p>
              <p className="mt-1 text-2xl font-bold">{formatMoney(owed.find((o) => o.currency === c)?._sum.amount ?? 0, c)}</p>
              <p className="mt-2 text-xs text-zinc-400">
                Earned {formatMoney(total(c, "EARN"), c)} · used {formatMoney(-total(c, "SPEND") - total(c, "RELEASE"), c)} · expired{" "}
                {formatMoney(-total(c, "EXPIRE"), c)}
              </p>
            </div>
          ))
        )}
      </section>

      <section className={card}>
        <h2 className="mb-1 text-sm font-semibold">Add or remove cashback</h2>
        <p className="mb-3 text-xs text-zinc-400">A positive amount adds credit (it expires like earned cashback); a negative amount removes it, up to the available balance. Recorded in the audit log.</p>
        <CashbackAdjustForm />
      </section>

      <section className="overflow-hidden rounded-lg border border-white/10">
        <h2 className="border-b border-white/10 px-3 py-2 text-sm font-semibold">Recent activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Customer</th>
                <th className={th}>Kind</th>
                <th className={th}>Order</th>
                <th className={`${th} text-end`}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap text-zinc-400`}>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className={td}>{r.user.email}</td>
                  <td className={td}>
                    {r.kind}
                    {r.note ? <span className="block text-xs text-zinc-500">{r.note}</span> : null}
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {r.orderId ? (
                      <Link href={`/dashboard/admin/orders/${r.orderId}`} className="hover:underline">
                        #{r.orderId.slice(-8).toUpperCase()}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${td} text-end tabular-nums ${r.amount > 0 ? "text-emerald-300" : ""}`}>{formatMoney(r.amount, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
