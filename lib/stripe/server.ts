/**
 * Server-only Stripe access. Never import this from a client component.
 *
 * Secrets come only from server environment variables:
 *   STRIPE_SECRET_KEY      sk_test_... (development / staging)
 *   STRIPE_WEBHOOK_SECRET  whsec_...
 * Live keys (sk_live_ / rk_live_) are refused unless
 * STRIPE_LIVE_MODE_ENABLED="true" is set deliberately, so a staging or
 * development deployment cannot make live charges by accident.
 */
import Stripe from "stripe";

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

let client: Stripe | null = null;

function isPlaceholder(v: string | undefined) {
  return !v || v.includes("YOUR_KEY") || v.trim() === "";
}

export function liveModeAllowed(): boolean {
  return process.env.STRIPE_LIVE_MODE_ENABLED === "true";
}

export function isStripeServerConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY;
  if (isPlaceholder(key)) return false;
  if (/^(sk|rk)_live_/.test(key!) && !liveModeAllowed()) return false;
  return true;
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (isPlaceholder(key)) throw new StripeConfigError("Stripe is not configured.");
  if (/^(sk|rk)_live_/.test(key!) && !liveModeAllowed()) {
    throw new StripeConfigError("Live Stripe keys are disabled in this environment.");
  }
  if (!client) {
    client = new Stripe(key!, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "LegendsBoost" },
    });
  }
  return client;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (isPlaceholder(secret)) throw new StripeConfigError("Stripe webhook secret is not configured.");
  return secret!;
}

/**
 * Verify a webhook signature and parse the event. Uses the static helper, so
 * verification works even if the API key is missing. Throws
 * Stripe.errors.StripeSignatureVerificationError on a bad signature.
 */
export function constructWebhookEvent(rawBody: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Absolute base URL for Stripe redirects. Taken from configuration only
 * (APP_URL, else NEXTAUTH_URL), never from request headers, so a forged
 * Host header cannot redirect customers elsewhere.
 */
export function getAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!raw) throw new StripeConfigError("APP_URL is not configured.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StripeConfigError("APP_URL is not a valid URL.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new StripeConfigError("APP_URL must use https in production.");
  }
  return url.origin;
}

/** Stripe uses lower-case currency codes; we store upper case. */
export function toStripeCurrency(currency: string): string {
  return currency.toLowerCase();
}
export function fromStripeCurrency(currency: string | null | undefined): string {
  return String(currency ?? "").toUpperCase();
}

/** Short, secret-free description of an error, safe for logs and the DB. */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof Stripe.errors.StripeError) return `${e.type}${e.code ? `/${e.code}` : ""}: ${e.message}`.slice(0, 500);
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 500);
  return "Unknown error";
}
