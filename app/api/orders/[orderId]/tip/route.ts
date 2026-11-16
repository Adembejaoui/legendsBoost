import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { createTipCheckout, TipError } from "@/lib/tips/service";
import { StripeConfigError } from "@/lib/stripe/server";
import { logger } from "@/lib/logger";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const body = z.object({ amount: z.number().int().positive() }).strict();

/** Customer: start a Stripe Checkout for a tip on a completed order; returns the payment page URL. */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((user.role ?? "CUSTOMER") !== "CUSTOMER") return NextResponse.json({ error: "Only the customer can tip." }, { status: 403 });
  const rl = await sharedRateLimit("tip", user.id, LIMITS.tipPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a tip amount." }, { status: 400 });
  try {
    const { orderId } = await params;
    return NextResponse.json(await createTipCheckout(user.id, orderId, parsed.data.amount), { status: 201 });
  } catch (e) {
    if (e instanceof TipError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof StripeConfigError) return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
    logger.error("Tip checkout failed", { error: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "Could not start the tip payment." }, { status: 500 });
  }
}
