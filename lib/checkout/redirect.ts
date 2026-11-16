/** Full-page navigation to Stripe-hosted Checkout (isolated so tests can observe it). */
export function redirectToStripeCheckout(url: string) {
  window.location.assign(url)
}
