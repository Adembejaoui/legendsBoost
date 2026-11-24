import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getRoleHomePath } from "@/lib/dashboard/role-routing";
import { cashbackSettings, cashbackSummary } from "@/lib/cashback/service";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  EARN: "Earned",
  SPEND: "Used on an order",
  RELEASE: "Given back (checkout not paid)",
  EXPIRE: "Expired",
  REVERSE: "Taken back (refund)",
  RETURN: "Given back (refund)",
  ADJUST: "Adjusted by support",
};

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Customer: cashback balance per currency and history (2026-11-24). */
export default async function CustomerCashbackPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "CUSTOMER") redirect(getRoleHomePath(ctx.user.role));

  const [{ balances, history }, settings] = await Promise.all([cashbackSummary(ctx.user.id), cashbackSettings()]);
  const rate = settings.rateBps / 100;
  const maxShare = settings.maxOrderBps / 100;

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Cashback</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          You get {rate}% of what you pay back as cashback when an order is completed. Use it at checkout to pay up to {maxShare}% of a
          new order in the same currency. Cashback lasts {settings.expiryDays} days and cannot be withdrawn.
        </p>
      </div>

      {balances.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-6 py-10 text-center">
          <p className="text-sm font-medium text-white">No cashback yet</p>
          <p className="mt-1 text-sm text-zinc-400">Complete an order to earn your first cashback.</p>
          <Link href="/games" className="mt-4 inline-block rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400">
            Browse games
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((b) => (
            <div key={b.currency} className="rounded-xl border border-emerald-400/20 bg-gradient-to-b from-emerald-400/[0.08] to-transparent p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-300/80">Available · {b.currency}</p>
              <p className="mt-1 text-3xl font-bold tracking-tight">{formatMoney(b.available, b.currency)}</p>
              {b.expiringSoon > 0 && b.nextExpiry ? (
                <p className="mt-1 text-xs text-amber-200">
                  {formatMoney(b.expiringSoon, b.currency)} expires on {date(b.nextExpiry)}
                </p>
              ) : b.nextExpiry ? (
                <p className="mt-1 text-xs text-zinc-500">Next expiry: {date(b.nextExpiry)}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <h2 className="border-b border-white/10 px-4 py-3 text-sm font-semibold">History</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">What</th>
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-zinc-400">{date(h.at)}</td>
                    <td className="px-4 py-2">
                      {KIND_LABEL[h.kind] ?? h.kind}
                      {h.note ? <span className="block text-xs text-zinc-500">{h.note}</span> : null}
                      {h.expiresAt ? <span className="block text-xs text-zinc-500">Expires {date(h.expiresAt)}</span> : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {h.orderId ? (
                        <Link href={`/dashboard/${h.orderId}`} className="text-zinc-300 hover:text-white hover:underline">
                          #{h.orderId.slice(-8).toUpperCase()}
                        </Link>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums ${h.amount > 0 ? "text-emerald-300" : "text-zinc-300"}`}>
                      {h.amount > 0 ? "+" : "−"}
                      {formatMoney(Math.abs(h.amount), h.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
