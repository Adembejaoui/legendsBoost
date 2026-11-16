import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { claimOrder } from "@/lib/assignments/service";
import { poolErrorStatus } from "@/lib/pool/service";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

/** Take the order now: claim now (ceiling minus the discount), priority or preferred (full payout). */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rl = await sharedRateLimit("claim", user.id, LIMITS.claimPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  const { orderId } = await params;
  try {
    const { assignment } = await claimOrder(orderId, user.id);
    return NextResponse.json({ assignment: { id: assignment.id, status: assignment.status, awardMode: assignment.awardMode, payoutAmount: assignment.payoutAmount } }, { status: 201 });
  } catch (e) {
    const r = poolErrorStatus(e);
    return NextResponse.json({ error: r.status === 500 ? "Failed to claim order" : r.error, code: r.code }, { status: r.status });
  }
}
