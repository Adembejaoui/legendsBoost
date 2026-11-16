/**
 * Which Stripe mode this environment charges in, derived from the configured
 * secret key's PREFIX only (the key itself is never returned or logged).
 *
 *   "test"          sk_test_ / rk_test_  -> no real money can move
 *   "live"          sk_live_ / rk_live_
 *   "unconfigured"  missing or placeholder key
 *
 * Deliberately free of the Stripe SDK so the eligibility rules can import it.
 * Server-side only in effect: in a browser bundle STRIPE_SECRET_KEY is
 * undefined, so this returns "unconfigured" (the strictest answer).
 */
export type PaymentMode = "test" | "live" | "unconfigured";

export function paymentModeFromSecretKey(key: string | undefined): PaymentMode {
  if (!key || key.includes("YOUR_KEY")) return "unconfigured";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return "unconfigured";
}

export function serverPaymentMode(): PaymentMode {
  return paymentModeFromSecretKey(process.env.STRIPE_SECRET_KEY);
}
