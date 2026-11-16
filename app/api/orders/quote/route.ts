import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { clientIp } from "@/lib/security/shared-rate-limit";
import { orderRequestSchema } from "@/lib/pricing/order-input";
import { buildServerQuote, PricingError, publicQuote } from "@/lib/pricing/service";
import { logger } from "@/lib/logger";

/**
 * Server-side price quote for a configuration (no order is created).
 * Public: anyone browsing the configurator sees the live, authoritative
 * price (signing in is only required to create the order). Read-only: no
 * order, no payment, no personal data. Rate-limited per user, or per IP for
 * visitors.
 */
export async function POST(req: Request) {
  const user = await getSessionUser().catch(() => null);
  const who = user ? `user:${user.id}` : `ip:${clientIp(req.headers)}`;
  const limit = await sharedRateLimit("quote", who, LIMITS.quotePerClient);
  if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = orderRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  try {
    const { quote, serviceTitle, estimate, coupon } = await buildServerQuote(parsed.data, undefined, { customerId: user?.id });
    return NextResponse.json({
      quote: { ...publicQuote(quote), estimate, coupon: coupon ? { code: coupon.code, applied: coupon.applied, reason: coupon.reason } : null },
      serviceTitle,
    });
  } catch (e) {
    if (e instanceof PricingError) {
      // Server-side trace of WHY a quote was refused (no user data, no config values).
      if (e.status === 403 || e.status === 503) {
        logger.warn("Quote refused", { gameSlug: parsed.data.gameSlug, serviceSlug: parsed.data.serviceSlug, status: e.status, reason: e.message });
      }
      return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
    }
    logger.error("Quote failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
