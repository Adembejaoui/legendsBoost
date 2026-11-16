import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getPayoutMethodStatus, PayoutMethodError, setPayoutMethod } from "@/lib/finance/payout-methods";
import { logger } from "@/lib/logger";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function booster() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (user.role !== "BOOSTER") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { user } as const;
}

/** Booster: the saved payout method (masked hint only). */
export async function GET() {
  const b = await booster();
  if (b.error) return b.error;
  return NextResponse.json({ method: await getPayoutMethodStatus(b.user.id) }, { headers: NO_STORE });
}

/** Booster: add or replace the payout method (replacing locks payouts for 48 h). */
export async function PUT(req: Request) {
  const b = await booster();
  if (b.error) return b.error;
  const rl = await sharedRateLimit("payout-method", b.user.id, LIMITS.payoutMethodPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  try {
    const method = await setPayoutMethod(b.user.id, await req.json().catch(() => null));
    return NextResponse.json({ method }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof PayoutMethodError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    // Never log the body: it contains bank / wallet details.
    logger.error("Payout method update failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Could not save the payout method." }, { status: 500, headers: NO_STORE });
  }
}
