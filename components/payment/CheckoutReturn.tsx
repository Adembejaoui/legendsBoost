'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { formatMoney } from '@/lib/money'
import { clearAttemptForOrder } from '@/lib/checkout/session-state'
import type { OrderSummary } from '@/lib/orders/order-summary'
import { OrderConfirmed } from './OrderConfirmed'

interface PaymentStatus {
  orderId: string
  orderStatus: string
  paid: boolean
  amount: number | null
  currency: string | null
  latestPayment: { status: string; failed: boolean } | null
  canPay: boolean
  /** Present once the payment is confirmed. */
  summary: OrderSummary | null
}

const POLL_MS = 2500
const MAX_POLLS = 48 // ~2 minutes, then the customer can refresh

/**
 * Return page after Stripe Checkout (success or cancel). It only READS the
 * payment state from the backend; the order is marked paid exclusively by
 * the verified Stripe webhook, which may arrive a few seconds later.
 */
export function CheckoutReturn({ variant }: { variant: 'success' | 'cancelled' }) {
  const params = useSearchParams()
  const orderId = params.get('orderId')
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Number of completed status checks; drives polling and the timeout message.
  const [polls, setPolls] = useState(0)

  // Back from Stripe after paying: the next "Continue to Payment" for the same
  // configuration must create a NEW order, not replay this one. (This is not
  // proof of payment; the status below comes from the webhook-verified backend.)
  // A cancelled checkout is closed too, so the next attempt starts fresh.
  useEffect(() => {
    if (orderId) clearAttemptForOrder(orderId)
  }, [variant, orderId])

  // Cancelled: close the unpaid checkout (it never becomes an order) and offer
  // a way back to the configuration (selections are restored there).
  const [editHref, setEditHref] = useState<string | null>(null)
  useEffect(() => {
    if (variant !== 'cancelled' || !orderId) return
    let gone = false
    fetch(`/api/orders/${orderId}/checkout`, { method: 'DELETE', cache: 'no-store' })
      .catch(() => undefined)
      .then(() => fetch(`/api/orders/${orderId}`, { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const o = d?.order
        if (!gone && o?.gameSlug && o?.serviceSlug) setEditHref(`/games/${encodeURIComponent(o.gameSlug)}/services/${encodeURIComponent(o.serviceSlug)}`)
      })
      .catch(() => undefined)
    return () => {
      gone = true
    }
  }, [variant, orderId])

  useEffect(() => {
    if (!orderId) return
    // Poll on the success page until the webhook has confirmed the payment.
    if (polls > 0 && (variant !== 'success' || status?.paid || polls >= MAX_POLLS)) return
    let cancelled = false
    const t = setTimeout(
      () => {
        fetch(`/api/orders/${orderId}/payment`, { cache: 'no-store' })
          .then(async (res) => {
            if (!res.ok) throw new Error('Order not found.')
            return (await res.json()) as PaymentStatus
          })
          .then((data) => {
            if (cancelled) return
            setStatus(data)
            setPolls((n) => n + 1)
          })
          .catch((e) => {
            if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the payment status.')
          })
      },
      polls === 0 ? 0 : POLL_MS
    )
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [orderId, variant, polls, status?.paid])

  const amount = status?.amount != null && status.currency ? formatMoney(status.amount, status.currency) : null
  const processing = status?.latestPayment?.status === 'PROCESSING'

  let icon = <Loader2 className="size-8 animate-spin text-zinc-400" />
  let title = 'Checking your payment…'
  let text = 'This usually takes a few seconds.'
  if (!orderId) {
    icon = <XCircle className="size-8 text-rose-400" />
    title = 'Missing order reference'
    text = ''
  } else if (status?.paid) {
    icon = <CheckCircle2 className="size-8 text-emerald-400" />
    title = 'Payment confirmed'
    text = 'Your order is created and available to our boosters. You can follow it from your dashboard.'
  } else if (processing) {
    icon = <Clock className="size-8 text-amber-400" />
    title = 'Payment processing'
    text = 'Your payment method takes longer to confirm. We will notify you as soon as it is complete.'
  } else if (variant === 'cancelled') {
    icon = <XCircle className="size-8 text-zinc-400" />
    title = 'Payment cancelled'
    text = 'You have not been charged and no order was created. Your selections are saved if you want to try again.'
  } else if (status && polls >= MAX_POLLS) {
    icon = <Clock className="size-8 text-amber-400" />
    title = 'Still waiting for confirmation'
    text = 'Stripe has not confirmed the payment yet. Refresh this page in a minute; you will not be charged twice.'
  } else if (status?.latestPayment?.failed) {
    icon = <XCircle className="size-8 text-rose-400" />
    title = 'Payment not completed'
    text = 'The payment did not go through, so no order was created and you have not been charged.'
  }

  if (orderId && status?.paid && status.summary) {
    return (
      <>
        <SiteHeader />
        <OrderConfirmed orderId={orderId} summary={status.summary} />
        <SiteFooter />
      </>
    )
  }

  return (
    <>
      <SiteHeader />
      <main className="py-16 px-5">
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-white/10 bg-[#111319] p-6 text-center text-white">
          <div className="flex justify-center">{icon}</div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {text ? <p className="text-sm text-zinc-400">{text}</p> : null}
          {orderId && status?.paid ? <p className="text-xs text-zinc-500">Order {orderId.slice(-8).toUpperCase()}{amount ? ` · ${amount}` : ''}</p> : null}
          {error ? <p role="alert" className="text-sm text-rose-400">{error}</p> : null}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {editHref && !status?.paid ? (
              <Link href={editHref} className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white">Back to my configuration</Link>
            ) : null}
            {orderId && status?.paid ? (
              <Link href={`/dashboard/${orderId}`} className="rounded-md bg-white/10 px-4 py-2 text-sm">View order</Link>
            ) : (
              <Link href="/games" className="rounded-md bg-white/10 px-4 py-2 text-sm">Browse services</Link>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
