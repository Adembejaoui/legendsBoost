import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { createReview, ReviewError } from "@/lib/reviews/service";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

/** Customer: review a completed order (once). */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((user.role ?? "CUSTOMER") !== "CUSTOMER") return NextResponse.json({ error: "Only the customer can review an order." }, { status: 403 });
  const rl = await sharedRateLimit("review", user.id, LIMITS.reviewPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  try {
    const { orderId } = await params;
    const review = await createReview(user.id, orderId, await req.json().catch(() => null));
    return NextResponse.json({ review: { id: review.id } }, { status: 201 });
  } catch (e) {
    if (e instanceof ReviewError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 });
  }
}
