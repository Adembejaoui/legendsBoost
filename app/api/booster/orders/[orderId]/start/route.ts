import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { startAssignment } from "@/lib/assignments/service";
import { BoosterNotEligibleError, NotBoosterOwnerError, OrderNotFoundError, OrderStateConflictError } from "@/lib/assignments/types";

/** Booster: start a claimed order (CLAIMED -> IN_PROGRESS). */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { orderId } = await params;
  try {
    const r = await startAssignment(orderId, user.id);
    return NextResponse.json({ changed: r.changed, status: r.order.status });
  } catch (e) {
    if (e instanceof NotBoosterOwnerError || e instanceof OrderNotFoundError) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (e instanceof OrderStateConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof BoosterNotEligibleError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Could not start the order" }, { status: 500 });
  }
}
