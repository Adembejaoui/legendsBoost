import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { adminFinanceSummary, adminFinanceWorkQueue } from "@/lib/finance/queries";
import { EARNING_RELEASE_POLICY } from "@/lib/finance/earnings";
import { formatMoney } from "@/lib/money";
import { progressByAssignment, suggestSplit } from "@/lib/finance/split-suggestion";
import { RevealPayoutMethod } from "@/components/finance/PayoutMethodCard";
import {
  AllocateEarningForm, ApproveEarningButton, OutboxButtons, PayoutActions, RefundForm, RetryEventButton,
} from "@/components/finance/FinanceActions";

export const dynamic = "force-dynamic";

function money(map: Record<string, number>) {
  const e = Object.entries(map).filter(([, v]) => v !== 0);
  return e.length ? e.map(([c, v]) => formatMoney(v, c)).join(" · ") : "—";
}

const card = "rounded-lg border border-white/10 bg-white/5 p-4";
const section = "mt-8";
const th = "px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-zinc-400";
const td = "px-3 py-2 align-top";

export default async function AdminFinancePage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const [s, q] = await Promise.all([adminFinanceSummary(), adminFinanceWorkQueue()]);
  // Suggested split by progress for orders several boosters worked on (Phase 7).
  const suggestions = new Map<string, { basis: string; amounts: Record<string, number> }>();
  for (const e of q.earningsToReview) {
    const progress = await progressByAssignment(e.orderId, e.order.assignments);
    const split = progress ? suggestSplit(e.grossAmount - e.reversedAmount, progress.entries) : null;
    if (progress && split) {
      suggestions.set(e.id, {
        basis: progress.basis === "rank" ? "rank progress made while each booster held the order" : "wins each booster played",
        amounts: Object.fromEntries(split.map((x) => [x.id, x.amount])),
      });
    }
  }
  const neg = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([c, v]) => [c, -v]));

  return (
    <div className="text-white">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finance</h1>
          <p className="mt-1 text-sm text-zinc-400">All figures are computed from the immutable ledger. Amounts per currency.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/dashboard/admin/finance/pricing" className="rounded-md bg-white/10 px-3 py-1.5">Pricing &amp; commission</Link>
          <Link href="/dashboard/admin/finance/transactions" className="rounded-md bg-white/10 px-3 py-1.5">Transactions</Link>
          <Link href="/dashboard/admin/finance/coupons" className="rounded-md bg-white/10 px-3 py-1.5">Discount codes</Link>
          <Link href="/dashboard/admin/finance/cashback" className="rounded-md bg-white/10 px-3 py-1.5">Cashback</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <div className={card}><div className="text-xs text-zinc-400">Customer payments</div><div className="mt-1 font-semibold">{money(s.customerPayments)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Refunds</div><div className="mt-1 font-semibold">{money(neg(s.refunds))}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Platform commission (net)</div><div className="mt-1 font-semibold">{money(s.platformCommission)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Stripe fees (platform cost)</div><div className="mt-1 font-semibold">{money(s.stripeFees)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Booster share not yet allocated</div><div className="mt-1 font-semibold">{money(s.unallocatedBoosterShare)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Outstanding booster liabilities</div><div className="mt-1 font-semibold">{money(s.outstandingBoosterLiabilities)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Manual payouts</div><div className="mt-1 font-semibold">{money(s.boosterPayouts)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Dispute losses</div><div className="mt-1 font-semibold">{money(neg(s.disputeLosses))}</div></div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4 text-sm">
        <div className={card}><div className="text-xs text-zinc-400">Earnings pending release</div><div className="mt-1">{money(s.earnings.pending)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Earnings available</div><div className="mt-1">{money(s.earnings.available)}</div></div>
        <div className={card}><div className="text-xs text-zinc-400">Earnings on hold</div><div className="mt-1">{money(s.earnings.onHold)}</div></div>
        <div className={card}>
          <div className="text-xs text-zinc-400">Payments</div>
          <div className="mt-1">{s.payments.SUCCEEDED ?? 0} succeeded · {s.payments.FAILED ?? 0} failed · {(s.payments.OPEN ?? 0) + (s.payments.PROCESSING ?? 0)} open</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Release policy: {EARNING_RELEASE_POLICY.mode.replace(/_/g, " ").toLowerCase()}; order must be completed, with no open dispute and no pending refund.
      </p>

      <section className={section}>
        <h2 className="text-lg font-semibold">Payments needing review ({q.paymentsToReview.length})</h2>
        <p className="text-xs text-zinc-500">Money was received but not applied to the order (never published). Usually refund it.</p>
        {q.paymentsToReview.length ? (
          <table className="mt-2 w-full text-sm"><thead><tr><th className={th}>Order</th><th className={th}>Reason</th><th className={th}>Received</th><th className={th}>Refund</th></tr></thead>
            <tbody>{q.paymentsToReview.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className={td}><Link className="underline" href={`/dashboard/${p.orderId}`}>{p.orderId.slice(-8).toUpperCase()}</Link></td>
                <td className={td}>{p.reviewReason}</td>
                <td className={td}>{p.amountReceived != null ? formatMoney(p.amountReceived, p.currency) : "—"} (refunded {formatMoney(p.amountRefunded, p.currency)})</td>
                <td className={td}>{p.stripePaymentIntentId && (p.amountReceived ?? 0) > p.amountRefunded ? <RefundForm orderId={p.orderId} paymentId={p.id} maxAmount={(p.amountReceived ?? 0) - p.amountRefunded} currency={p.currency} /> : null}</td>
              </tr>))}</tbody></table>
        ) : <p className="mt-2 text-sm text-zinc-500">None.</p>}
      </section>

      <section className={section}>
        <h2 className="text-lg font-semibold">Earnings to allocate ({q.earningsToReview.length})</h2>
        <p className="text-xs text-zinc-500">Several boosters worked on these orders; contribution is not objectively known, so nothing was awarded automatically.</p>
        {q.earningsToReview.map((e) => (
          <div key={e.id} className="mt-3 rounded-lg border border-white/10 bg-white/3 p-3">
            <div className="mb-2 text-sm">Order <Link className="underline" href={`/dashboard/${e.orderId}`}>{e.orderId.slice(-8).toUpperCase()}</Link> · {formatMoney(e.grossAmount - e.reversedAmount, e.currency)} to allocate</div>
            <AllocateEarningForm
              earningId={e.id}
              netAmount={e.grossAmount - e.reversedAmount}
              suggestion={suggestions.get(e.id) ?? null}
              assignments={e.order.assignments.map((a) => ({ id: a.id, label: `${a.booster.name ?? a.booster.id} · ${a.status}${a.endReason ? ` (${a.endReason.slice(0, 40)})` : ""}` }))}
            />
          </div>
        ))}
        {!q.earningsToReview.length ? <p className="mt-2 text-sm text-zinc-500">None.</p> : null}
      </section>

      <section className={section}>
        <h2 className="text-lg font-semibold">Earnings awaiting release ({q.earningsToApprove.length})</h2>
        {q.earningsToApprove.length ? (
          <table className="mt-2 w-full text-sm"><thead><tr><th className={th}>Order</th><th className={th}>Booster</th><th className={th}>Amount</th><th className={th}>Order status</th><th className={th}></th></tr></thead>
            <tbody>{q.earningsToApprove.map((e) => (
              <tr key={e.id} className="border-t border-white/5">
                <td className={td}>{e.orderId.slice(-8).toUpperCase()}</td>
                <td className={td}>{e.booster?.name ?? e.boosterId}</td>
                <td className={td}>{formatMoney(e.grossAmount - e.reversedAmount, e.currency)}</td>
                <td className={td}>{e.order.status}</td>
                <td className={td}><ApproveEarningButton earningId={e.id} /></td>
              </tr>))}</tbody></table>
        ) : <p className="mt-2 text-sm text-zinc-500">None.</p>}
      </section>

      <section className={section}>
        <h2 className="text-lg font-semibold">Payout requests ({q.payoutRequests.length})</h2>
        {q.payoutRequests.length ? (
          <table className="mt-2 w-full text-sm"><thead><tr><th className={th}>Booster</th><th className={th}>Amount</th><th className={th}>Pay to</th><th className={th}>Status</th><th className={th}>Actions</th></tr></thead>
            <tbody>{q.payoutRequests.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className={td}>{p.booster.name ?? p.booster.email}</td>
                <td className={td}>
                  {formatMoney(p.amount, p.currency)}
                  {p.finesDeducted > 0 ? <div className="text-xs text-zinc-500">after {formatMoney(p.finesDeducted, p.currency)} fines</div> : null}
                </td>
                <td className={td}><RevealPayoutMethod payoutId={p.id} hint={p.methodHint} /></td>
                <td className={td}>{p.status}</td>
                <td className={td}><PayoutActions payoutId={p.id} status={p.status} /></td>
              </tr>))}</tbody></table>
        ) : <p className="mt-2 text-sm text-zinc-500">None.</p>}
      </section>

      <section className={section}>
        <h2 className="text-lg font-semibold">Open disputes ({q.openDisputes.length})</h2>
        {q.openDisputes.length ? (
          <table className="mt-2 w-full text-sm"><thead><tr><th className={th}>Order</th><th className={th}>Amount</th><th className={th}>Reason</th><th className={th}>Stripe status</th><th className={th}>Evidence due</th></tr></thead>
            <tbody>{q.openDisputes.map((d) => (
              <tr key={d.id} className="border-t border-white/5">
                <td className={td}>{d.orderId.slice(-8).toUpperCase()}</td>
                <td className={td}>{formatMoney(d.amount, d.currency)}</td>
                <td className={td}>{d.reason ?? "—"}</td>
                <td className={td}>{d.stripeStatus}</td>
                <td className={td}>{d.evidenceDueBy ? d.evidenceDueBy.toISOString().slice(0, 10) : "—"}</td>
              </tr>))}</tbody></table>
        ) : <p className="mt-2 text-sm text-zinc-500">None. Respond to disputes in the Stripe Dashboard.</p>}
      </section>

      <section className={section}>
        <h2 className="text-lg font-semibold">Recent payments</h2>
        <table className="mt-2 w-full text-sm"><thead><tr><th className={th}>Order</th><th className={th}>Attempt</th><th className={th}>Status</th><th className={th}>Amount</th><th className={th}>Refund</th></tr></thead>
          <tbody>{q.recentPayments.map((p) => (
            <tr key={p.id} className="border-t border-white/5">
              <td className={td}>{p.orderId.slice(-8).toUpperCase()}</td>
              <td className={td}>#{p.attemptNumber}</td>
              <td className={td}>{p.status}{p.failureCode ? <span className="ms-1 text-xs text-zinc-500">({p.failureCode})</span> : null}</td>
              <td className={td}>{formatMoney(p.amount, p.currency)}{p.amountRefunded ? <span className="ms-1 text-xs text-zinc-500">refunded {formatMoney(p.amountRefunded, p.currency)}</span> : null}</td>
              <td className={td}>{p.status === "SUCCEEDED" && !p.reviewReason && p.stripePaymentIntentId && (p.amountReceived ?? p.amount) > p.amountRefunded ? <RefundForm orderId={p.orderId} paymentId={p.id} maxAmount={(p.amountReceived ?? p.amount) - p.amountRefunded} currency={p.currency} /> : null}</td>
            </tr>))}</tbody></table>
        {q.pendingRefunds.length ? <p className="mt-2 text-xs text-amber-300">{q.pendingRefunds.length} refund(s) pending or failed; see transactions.</p> : null}
      </section>

      <section className={section}>
        <h2 className="text-lg font-semibold">Processing problems</h2>
        <div className="mt-2 flex items-center gap-3 text-sm"><span>Failed side effects: {q.failedOutbox.length}</span><OutboxButtons /></div>
        {q.failedEvents.length ? (
          <table className="mt-3 w-full text-sm"><thead><tr><th className={th}>Stripe event</th><th className={th}>Type</th><th className={th}>Attempts</th><th className={th}>Error</th><th className={th}></th></tr></thead>
            <tbody>{q.failedEvents.map((e) => (
              <tr key={e.id} className="border-t border-white/5">
                <td className={`${td} font-mono text-xs`}>{e.stripeEventId}</td>
                <td className={td}>{e.type}</td>
                <td className={td}>{e.attempts}</td>
                <td className={`${td} text-xs text-zinc-400`}>{e.lastError}</td>
                <td className={td}><RetryEventButton eventId={e.id} /></td>
              </tr>))}</tbody></table>
        ) : <p className="mt-2 text-sm text-zinc-500">No failed webhook events.</p>}
      </section>
    </div>
  );
}
