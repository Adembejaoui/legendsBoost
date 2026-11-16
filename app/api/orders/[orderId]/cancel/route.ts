import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";

/**
 * Customer self-cancellation is DISABLED: customers may only pause and
 * resume their orders. Cancellations (and refunds) are handled by an admin
 * (POST /api/admin/orders/[orderId]/cancel) after the customer contacts
 * support. Kept as an explicit 403 so old clients get a clear answer.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_req: Request, _ctx: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { error: "Orders can't be cancelled from your account. You can pause it, or contact support." },
    { status: 403 }
  );
}
