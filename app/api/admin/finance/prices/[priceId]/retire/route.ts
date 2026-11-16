import { NextResponse } from "next/server";
import { requireRole, financeErrorResponse } from "@/lib/finance/http";
import { retireServicePrice } from "@/lib/pricing/admin.service";

/** Admin: retire the active price; the service becomes unpurchasable. */
export async function POST(_req: Request, { params }: { params: Promise<{ priceId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    const { priceId } = await params;
    const price = await retireServicePrice(g.user.id, priceId);
    return NextResponse.json({ price: { id: price.id, status: price.status } });
  } catch (e) {
    return financeErrorResponse(e);
  }
}
