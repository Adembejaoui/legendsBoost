import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { ReviewError, setReviewHidden } from "@/lib/reviews/service";

const body = z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();

/** Admin: hide or show a review (audited). */
export async function POST(req: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { reviewId } = await params;
    return NextResponse.json(await setReviewHidden(user.id, reviewId, parsed.data.hidden, parsed.data.reason));
  } catch (e) {
    if (e instanceof ReviewError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Could not update the review." }, { status: 500 });
  }
}
