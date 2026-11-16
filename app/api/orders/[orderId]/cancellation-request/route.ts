import { NextResponse } from "next/server";
import { requireRole, readJson } from "@/lib/finance/http";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { CancellationRequestError, requestCancellation, withdrawCancellation } from "@/lib/orders/cancellation-request.service";

/**
 * Customer: ask to cancel a paid order (reviewed by an admin), or withdraw
 * the request. Customers never cancel directly (see cancellation-request.service).
 */
function errorResponse(e: unknown) {
  if (e instanceof CancellationRequestError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("CUSTOMER");
  if (!g.ok) return g.response;
  const limit = await sharedRateLimit("cancel-request", g.user.id, LIMITS.cancellationRequestPerUser);
  if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const { orderId } = await params;
    const body = (await readJson(req)) as { reason?: unknown } | null;
    const request = await requestCancellation(g.user.id, orderId, body?.reason);
    return NextResponse.json({ request: { id: request.id, status: request.status } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("CUSTOMER");
  if (!g.ok) return g.response;
  try {
    const { orderId } = await params;
    return NextResponse.json(await withdrawCancellation(g.user.id, orderId));
  } catch (e) {
    return errorResponse(e);
  }
}
