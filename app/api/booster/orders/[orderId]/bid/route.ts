import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { placeBid, poolErrorStatus, withdrawBid } from "@/lib/pool/service";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const bodySchema = z.object({ amount: z.number().int().positive() }).strict();

async function booster() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "BOOSTER") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/** Place or change a sealed bid (amount in minor units, at most the payout ceiling). */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const b = await booster();
  if (b.error) return b.error;
  const rl = await sharedRateLimit("bid", b.user.id, LIMITS.bidPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a whole amount in cents.", code: "AMOUNT_OUT_OF_RANGE" }, { status: 422 });
  const { orderId } = await params;
  try {
    return NextResponse.json(await placeBid(b.user.id, orderId, parsed.data.amount), { status: 201 });
  } catch (e) {
    const r = poolErrorStatus(e);
    return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
  }
}

/** Withdraw the booster's bid while the window is open. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const b = await booster();
  if (b.error) return b.error;
  const rl = await sharedRateLimit("bid", b.user.id, LIMITS.bidPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  const { orderId } = await params;
  try {
    return NextResponse.json(await withdrawBid(b.user.id, orderId));
  } catch (e) {
    const r = poolErrorStatus(e);
    return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
  }
}
