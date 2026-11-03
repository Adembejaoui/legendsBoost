'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { PaymentOrderSummary } from './PaymentOrderSummary'
import { StripePaymentProvider } from './StripePaymentProvider'
import { StripePaymentForm } from './StripePaymentForm'
import type { OrderDraft } from '@/types/order'

export function PaymentPageClient() {
  const params = useSearchParams()
  const router = useRouter()
  const orderId = params.get('orderId')
  const [draft, setDraft] = useState<OrderDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!orderId) {
        setError('Missing order ID')
        setLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/orders/${orderId}`)
        if (!res.ok) {
          setError('Order not found')
          setLoading(false)
          return
        }
        const data = await res.json()
        setDraft(data.draft)
      } catch (e) {
        setError('Failed to load order')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [orderId])

  if (loading) {
    return (
      <>
        <SiteHeader />
        <main className="py-10 px-5 text-white">
          <div className="mx-auto max-w-6xl">Loading payment details...</div>
        </main>
        <SiteFooter />
      </>
    )
  }

  if (error || !draft) {
    return (
      <>
        <SiteHeader />
        <main className="py-10 px-5 text-white">
          <div className="mx-auto max-w-6xl space-y-4">
            <h1 className="text-2xl font-semibold">Complete Your Payment</h1>
            <p className="text-zinc-400">{error || 'Order not found'}</p>
            <div className="flex gap-3">
              <button onClick={() => router.push('/checkout/review')} className="px-4 py-2 rounded bg-white/10">Back to Review</button>
              <button onClick={() => router.back()} className="px-4 py-2 rounded bg-white/10">Go Back</button>
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    )
  }

  return (
    <>
      <SiteHeader />
      <main className="py-10 px-5">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Complete Your Payment</h1>
            <p className="text-zinc-400">Payment is processed securely. Powered by Stripe.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <StripePaymentProvider options={{ mode: 'payment', amount: 0, currency: 'usd' }}>
              <StripePaymentForm />
            </StripePaymentProvider>
            <PaymentOrderSummary draft={draft} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}