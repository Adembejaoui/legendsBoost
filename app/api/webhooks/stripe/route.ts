import { NextResponse } from "next/server";
import { receiveStripeWebhook } from "@/lib/payments/webhook.service";
import { logger } from "@/lib/logger";

/**
 * Stripe webhook endpoint. The signature is verified on the RAW body
 * (req.text(), never parsed first) with STRIPE_WEBHOOK_SECRET. No session or
 * cookie auth: Stripe's signature is the authentication.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  try {
    const result = await receiveStripeWebhook(rawBody, signature);
    if (result.status >= 500) logger.error("Stripe webhook processing failed", { error: result.body.error });
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    // Never log the payload or headers (they can contain customer data).
    logger.error("Stripe webhook error", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
