import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getOrderPaymentStatus } from "@/lib/payments/checkout.service";

/**
 * Read-only payment state for the order owner (or an admin). The checkout
 * success page polls this; it never changes payment or order state.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderId } = await params;
  const status = await getOrderPaymentStatus(user.id, user.role, orderId);
  if (!status) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
