import { loadStripe, Stripe } from '@stripe/stripe-js'

let stripePromise: Promise<Stripe | null>

export function getStripe() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!key || key.includes('YOUR_KEY')) {
      stripePromise = Promise.resolve(null)
      return stripePromise
    }
    stripePromise = loadStripe(key)
  }
  return stripePromise
}

export function isStripeConfigured() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  return Boolean(key && !key.includes('YOUR_KEY'))
}
