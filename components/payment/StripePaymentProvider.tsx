'use client'

import { Elements } from '@stripe/react-stripe-js'
import { getStripe, isStripeConfigured } from '@/lib/stripe/stripe-client'
import { ReactNode } from 'react'

interface StripePaymentProviderProps {
  children: ReactNode
  options?: any
}

export function StripePaymentProvider({ children, options }: StripePaymentProviderProps) {
  const stripePromise = getStripe()

  if (!isStripeConfigured()) {
    return <>{children}</>
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  )
}