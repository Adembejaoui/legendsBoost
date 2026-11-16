import { NextResponse } from "next/server";
import { requireRole, readJson } from "@/lib/finance/http";
import { CancellationRequestError, decideCancellation } from "@/lib/orders/cancellation-request.service";

/**
 * Admin: approve (cancel + refund `refundAmount` minor units) or reject (note
 * required) a customer's cancellation request.
 */
export async function POST(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    const { requestId } = await params;
    const result = await decideCancellation(g.user.id, requestId, await readJson(req));
    return NextResponse.json(result, { status: result.status === "APPROVED" && "refundError" in result && result.refundError ? 207 : 200 });
  } catch (e) {
    if (e instanceof CancellationRequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
