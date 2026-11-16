// Server-only module.
/**
 * PaymentProvider: the hosted-checkout operations the order flow needs.
 * StripePaymentProvider wraps the existing Stripe client. The checkout and
 * webhook services still call Stripe directly; they move onto this interface
 * when a second provider is added (build plan Phase 10).
 */
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";

export interface CheckoutSessionInput {
  amount: number;
  currency: string;
  productName: string;
  description?: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  idempotencyKey: string;
}

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
  amountTotal: number | null;
  currency: string | null;
  expiresAt: Date | null;
  paymentIntentId: string | null;
}

export interface PaymentProvider {
  readonly kind: "stripe" | "fake";
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  expireCheckoutSession(sessionId: string): Promise<void>;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly kind = "stripe" as const;
  constructor(private stripe: Stripe = getStripe()) {}

  async createCheckoutSession(i: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const s = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: i.currency.toLowerCase(),
              unit_amount: i.amount,
              product_data: { name: i.productName, description: i.description },
            },
          },
        ],
        metadata: i.metadata,
        payment_intent_data: { metadata: i.metadata },
        expires_at: Math.floor(i.expiresAt.getTime() / 1000),
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
      },
      { idempotencyKey: i.idempotencyKey }
    );
    return {
      id: s.id,
      url: s.url,
      amountTotal: s.amount_total,
      currency: s.currency ? s.currency.toUpperCase() : null,
      expiresAt: s.expires_at ? new Date(s.expires_at * 1000) : null,
      paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
    };
  }

  async expireCheckoutSession(sessionId: string) {
    await this.stripe.checkout.sessions.expire(sessionId);
  }
}
