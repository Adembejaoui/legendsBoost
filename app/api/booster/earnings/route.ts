import { NextResponse } from "next/server";
import { requireRole } from "@/lib/finance/http";
import { boosterFinance } from "@/lib/finance/queries";

/** The signed-in booster's own earnings and payouts (never another booster's). */
export async function GET() {
  const g = await requireRole("BOOSTER");
  if (!g.ok) return g.response;
  return NextResponse.json(await boosterFinance(g.user.id), { headers: { "Cache-Control": "no-store" } });
}
