import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getPoolForBooster, poolErrorStatus } from "@/lib/pool/service";
import { verifyBoosterEligibility } from "@/lib/assignments/service";

/** The pool for the signed-in booster (filtered by their permissions; payout only, never the customer price). */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await verifyBoosterEligibility(user.id);
    const gameSlug = new URL(req.url).searchParams.get("game") || undefined;
    return NextResponse.json(await getPoolForBooster(user.id, { gameSlug }));
  } catch (e) {
    const r = poolErrorStatus(e);
    return NextResponse.json({ error: r.status === 500 ? "Failed to fetch available orders" : r.error }, { status: r.status });
  }
}
