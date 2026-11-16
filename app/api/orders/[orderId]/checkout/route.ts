import { NextResponse } from "next/server";
import { requireRole, financeErrorResponse } from "@/lib/finance/http";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { abandonCheckout, createCheckoutForOrder } from "@/lib/payments/checkout.service";

/**
 * Start Stripe Checkout for the caller's checkout hold (AWAITING_PAYMENT,
 * created moments ago by POST /api/orders). Not a "pay later" endpoint: holds
 * older than CHECKOUT_HOLD_TTL_MS are refused and closed.
 * Returns { url } to redirect to. The amount comes from the order's price
 * snapshot only; the request body is ignored.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("CUSTOMER");
  if (!g.ok) return g.response;
  const limit = await sharedRateLimit("checkout", g.user.id, LIMITS.checkoutPerUser);
  if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const { orderId } = await params;
    const result = await createCheckoutForOrder(g.user.id, orderId);
    return NextResponse.json({ url: result.url, reused: result.reused }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return financeErrorResponse(e, "Could not start the payment.");
  }
}

/**
 * The customer came back from Stripe without paying (cancel page): close the
 * unpaid checkout hold so it never becomes an order. Idempotent.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("CUSTOMER");
  if (!g.ok) return g.response;
  try {
    const { orderId } = await params;
    return NextResponse.json(await abandonCheckout(g.user.id, orderId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return financeErrorResponse(e, "Could not cancel the checkout.");
  }
}
