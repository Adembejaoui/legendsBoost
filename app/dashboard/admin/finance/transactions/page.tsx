import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { listTransactions } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-400";
const td = "px-3 py-1.5 align-top";

/** Read-only view of the immutable ledger. */
export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; boosterId?: string; cursor?: string }>;
}) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const sp = await searchParams;
  const { transactions, nextCursor } = await listTransactions({ orderId: sp.orderId, boosterId: sp.boosterId, cursor: sp.cursor });
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(sp.orderId ? { orderId: sp.orderId } : {}), ...(sp.boosterId ? { boosterId: sp.boosterId } : {}), ...extra }).toString();

  return (
    <div className="text-white">
      <Link href="/dashboard/admin/finance" className="text-sm text-zinc-400 underline">← Finance</Link>
      <h1 className="mt-2 text-2xl font-bold">Ledger transactions</h1>
      <p className="mt-1 text-sm text-zinc-400">Append-only. Corrections appear as compensating entries, never as edits.</p>
      <form className="mt-4 flex flex-wrap gap-2 text-sm">
        <input name="orderId" defaultValue={sp.orderId} placeholder="Order id" className="rounded-md border border-white/10 bg-black/30 px-2 py-1" />
        <input name="boosterId" defaultValue={sp.boosterId} placeholder="Booster id" className="rounded-md border border-white/10 bg-black/30 px-2 py-1" />
        <button className="rounded-md bg-white/10 px-3 py-1">Filter</button>
      </form>
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-200 text-sm">
          <thead className="bg-white/5"><tr><th className={th}>When</th><th className={th}>Type</th><th className={th}>Account</th><th className={th}>Amount</th><th className={th}>Order</th><th className={th}>Booster</th><th className={th}>Reference</th></tr></thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t border-white/5">
                <td className={`${td} text-xs text-zinc-400`}>{t.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className={td}>{t.type}</td>
                <td className={td}>{t.account}</td>
                <td className={`${td} ${t.amount < 0 ? "text-rose-300" : "text-emerald-300"}`}>{formatMoney(t.amount, t.currency)}</td>
                <td className={td}>{t.orderId ? <Link className="underline" href={`?${qs({ orderId: t.orderId })}`}>{t.orderId.slice(-8).toUpperCase()}</Link> : "—"}</td>
                <td className={td}>{t.boosterId ? t.boosterId.slice(-8) : "—"}</td>
                <td className={`${td} text-xs text-zinc-500`}>{t.paymentId ? `payment ${t.paymentId.slice(-6)}` : t.refundId ? `refund ${t.refundId.slice(-6)}` : t.payoutId ? `payout ${t.payoutId.slice(-6)}` : t.disputeId ? `dispute ${t.disputeId.slice(-6)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor ? <Link href={`?${qs({ cursor: nextCursor })}`} className="mt-3 inline-block text-sm underline">Older →</Link> : null}
    </div>
  );
}
