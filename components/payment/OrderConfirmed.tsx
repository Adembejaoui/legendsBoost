import Link from 'next/link'
import { ArrowRight, Check, LayoutDashboard } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import type { OrderSummary, OrderSummaryRank } from '@/lib/orders/order-summary'
import { gameThemeStyle } from '@/components/orders/workspace/game-theme'

function RankBadge({ rank, caption }: { rank: OrderSummaryRank | null; caption: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{caption}</span>
      {rank?.iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- small local emblem
        <img src={rank.iconSrc} alt="" className="size-16 object-contain drop-shadow-[0_0_18px_rgba(var(--g-rgb),0.35)] sm:size-20" />
      ) : (
        <div className="size-16 rounded-full border border-white/10 bg-white/5 sm:size-20" />
      )}
      <span className="text-sm font-semibold text-white">{rank?.label ?? '—'}</span>
    </div>
  )
}

/**
 * Checkout success, once the payment is confirmed: a receipt of what was
 * bought, in the colours of the order's game.
 */
export function OrderConfirmed({ orderId, summary }: { orderId: string; summary: OrderSummary }) {
  const p = summary.pricing
  const money = (n: number) => (p ? formatMoney(n, p.currency) : '')
  return (
    <main className="relative overflow-hidden px-4 py-10 sm:py-16" style={gameThemeStyle(summary.gameSlug)} data-game={summary.gameSlug}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(var(--g-rgb),0.22),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-2xl space-y-5">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 grid size-16 place-items-center rounded-full bg-[var(--g-accent)] text-[var(--g-on)] shadow-[0_0_40px_rgba(var(--g-rgb),0.55)]">
            <Check className="size-8" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Order confirmed</h1>
          <p className="mt-2 max-w-md text-sm text-zinc-400">Thank you! Your payment is confirmed and your order is now available to our boosters.</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              Order <span className="font-mono font-semibold text-white">#{summary.reference}</span>
            </span>
            {p ? (
              <span className="rounded-full border border-[rgba(var(--g-rgb),0.35)] bg-[rgba(var(--g-rgb),0.12)] px-3 py-1 font-semibold text-[var(--g-light)]">
                Paid {money(p.totalAmount)}
              </span>
            ) : null}
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111319]/90 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-4 border-b border-white/10 p-4 sm:p-5">
            {summary.gameImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- local game art
              <img src={summary.gameImage} alt="" className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-[rgba(var(--g-rgb),0.4)]" />
            ) : null}
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--g-light)]">{summary.gameName}</p>
              <h2 className="truncate text-lg font-semibold text-white">{summary.serviceName}</h2>
              {summary.mode ? <p className="text-xs text-zinc-400">{summary.mode}</p> : null}
            </div>
          </div>

          {summary.ranks ? (
            <div className="flex items-center gap-2 border-b border-white/10 bg-[rgba(var(--g-rgb),0.05)] px-4 py-5 sm:px-8">
              <RankBadge rank={summary.ranks.from} caption="Current rank" />
              <ArrowRight className="size-6 shrink-0 text-[var(--g-accent)]" />
              <RankBadge rank={summary.ranks.to} caption="Target rank" />
            </div>
          ) : null}

          {summary.details.length > 0 || summary.options.length > 0 ? (
            <div className="space-y-3 border-b border-white/10 p-4 sm:p-5">
              {summary.details.length > 0 ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {summary.details.map((d) => (
                    <div key={d.label} className="flex justify-between gap-3">
                      <dt className="text-zinc-500">{d.label}</dt>
                      <dd className="text-right font-medium text-zinc-200">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {summary.options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {summary.options.map((o) => (
                    <span
                      key={o}
                      className="inline-flex items-center gap-1 rounded-full border border-[rgba(var(--g-rgb),0.3)] bg-[rgba(var(--g-rgb),0.08)] px-2.5 py-0.5 text-xs text-[var(--g-light)]"
                    >
                      <Check className="size-3" /> {o}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {p ? (
            <div className="space-y-1.5 p-4 text-sm sm:p-5">
              {p.lines.map((l, i) => (
                <div key={`${l.label}-${i}`} className="flex justify-between gap-3 text-zinc-400">
                  <span>{l.label}</span>
                  <span>{money(l.amount)}</span>
                </div>
              ))}
              {p.discountAmount > 0 ? (
                <div className="flex justify-between gap-3 text-emerald-400">
                  <span>Discount</span>
                  <span>−{money(p.discountAmount)}</span>
                </div>
              ) : null}
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-white/10 pt-3">
                <span className="font-semibold text-white">Total paid</span>
                <span className="text-xl font-bold text-[var(--g-light)]">{money(p.totalAmount)}</span>
              </div>
            </div>
          ) : null}
        </section>

        <p className="text-center text-xs text-zinc-500">A confirmation email with these details is on its way.</p>

        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            href={`/dashboard/${orderId}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--g-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--g-on)] shadow-[0_0_24px_rgba(var(--g-rgb),0.35)] transition hover:bg-[var(--g-hover)]"
          >
            Open my order <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/10"
          >
            <LayoutDashboard className="size-4" /> Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
