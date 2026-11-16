/* eslint-disable @typescript-eslint/no-explicit-any -- Stripe object fakes */
/**
 * Minimal in-memory Stripe API fake (no network). Webhook signing and
 * verification use the REAL stripe SDK helpers, so signature handling is
 * tested exactly as in production.
 */
import Stripe from "stripe";

export const WEBHOOK_SECRET = "whsec_test_legendsboost_unit";

// Module-level so ids stay unique across fresh fakes (the database enforces
// uniqueness of Stripe ids just like production would).
let seq = 0;
const run = Math.random().toString(36).slice(2, 8);

export function createFakeStripe() {
  const next = (p: string) => `${p}_test_${run}_${++seq}`;
  const sessionsByKey = new Map<string, any>();
  const state = {
    failNextSessionCreate: false,
    refundStatus: "succeeded" as "succeeded" | "pending" | "failed",
    failNextRefund: false,
    sessionCreateCalls: [] as { params: any; options: any }[],
    refundCreateCalls: [] as { params: any; options: any }[],
    expired: [] as string[],
    refundsByCharge: new Map<string, any[]>(),
    fee: 320,
  };
  const client = {
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          state.sessionCreateCalls.push({ params, options });
          if (state.failNextSessionCreate) {
            state.failNextSessionCreate = false;
            throw new Stripe.errors.StripeAPIError({ message: "Simulated Stripe outage", type: "api_error" } as any);
          }
          const key = options?.idempotencyKey;
          if (key && sessionsByKey.has(key)) return sessionsByKey.get(key);
          const li = params.line_items[0];
          const session = {
            id: next("cs"),
            object: "checkout.session",
            url: `https://checkout.stripe.test/${seq}`,
            amount_total: li.price_data.unit_amount * li.quantity,
            currency: li.price_data.currency,
            expires_at: params.expires_at,
            payment_intent: null,
            metadata: params.metadata,
            client_reference_id: params.client_reference_id,
          };
          if (key) sessionsByKey.set(key, session);
          return session;
        },
        expire: async (id: string) => {
          state.expired.push(id);
          return { id, status: "expired" };
        },
      },
    },
    refunds: {
      create: async (params: any, options: any) => {
        state.refundCreateCalls.push({ params, options });
        if (state.failNextRefund) {
          state.failNextRefund = false;
          throw new Stripe.errors.StripeInvalidRequestError({ message: "Charge already refunded", type: "invalid_request_error" } as any);
        }
        return {
          id: next("re"),
          object: "refund",
          amount: params.amount,
          currency: "eur",
          status: state.refundStatus,
          payment_intent: params.payment_intent,
          metadata: params.metadata,
          failure_reason: state.refundStatus === "failed" ? "declined" : null,
        };
      },
      list: async ({ charge }: { charge: string }) => ({ data: state.refundsByCharge.get(charge) ?? [], has_more: false }),
    },
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        latest_charge: { id: `ch_for_${id}`, balance_transaction: { fee: state.fee, currency: "eur" } },
      }),
    },
  };
  return { client, state, next };
}

/** A signed webhook request body + header, using the real Stripe helper. */
export function signEvent(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

let evtSeq = 0;
export function stripeEvent(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  evtSeq += 1;
  return {
    id: `evt_test_${Date.now()}_${evtSeq}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
    ...extra,
  };
}
