'use client'

import { PaymentElement } from '@stripe/react-stripe-js'

export function StripePaymentElement() {
  return (
    <PaymentElement
      options={{
        layout: 'accordion',
      }}
    />
  )
}