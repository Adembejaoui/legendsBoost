import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { PayoutMethodError, revealPayoutMethod } from "@/lib/finance/payout-methods";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/** Admin: the payout details copied on this payout, to pay it (audited). POST so it is never cached or prefetched. */
export async function POST(_req: Request, { params }: { params: Promise<{ payoutId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { payoutId } = await params;
    return NextResponse.json({ details: await revealPayoutMethod(user.id, payoutId) }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof PayoutMethodError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    return NextResponse.json({ error: "Could not read the payout details." }, { status: 500, headers: NO_STORE });
  }
}
