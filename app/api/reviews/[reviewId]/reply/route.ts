import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { replyToReview, ReviewError } from "@/lib/reviews/service";

const body = z.object({ reply: z.string().trim().min(2).max(1000) }).strict();

/** Booster: reply once to a review of their work. */
export async function POST(req: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a reply (up to 1000 characters)." }, { status: 400 });
  try {
    const { reviewId } = await params;
    return NextResponse.json(await replyToReview(user.id, reviewId, parsed.data.reply));
  } catch (e) {
    if (e instanceof ReviewError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Could not save the reply." }, { status: 500 });
  }
}
