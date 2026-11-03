'use client'

import { useState } from 'react'
import { StripePaymentElement } from './StripePaymentElement'
import { isStripeConfigured } from '@/lib/stripe/stripe-client'

export function StripePaymentForm() {
  const [disabled] = useState(true)
  const configured = isStripeConfigured()

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Payment Method</h2>
        <p className="text-xs text-zinc-400">Secure payment form</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        {!configured ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <p className="text-sm text-white">Stripe payment preview</p>
            <p className="mt-1 text-xs text-zinc-400">Configure NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to enable Stripe Elements.</p>
            <div className="mt-3 h-24 rounded border border-dashed border-white/10 flex items-center justify-center text-xs text-zinc-500">
              Stripe Payment Element (preview)
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <StripePaymentElement />
          </div>
        )}

        <button
          type="button"
          disabled={disabled}
          className="w-full rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pay Now
        </button>
        <p className="text-center text-xs text-zinc-500">Payments will be enabled once secure payment processing is configured.</p>
      </div>
    </div>
  )
}