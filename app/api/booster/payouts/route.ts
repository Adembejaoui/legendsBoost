import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { requestPayout } from "@/lib/finance/payouts";
import { boosterFinance } from "@/lib/finance/queries";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

export async function GET() {
  const g = await requireRole("BOOSTER");
  if (!g.ok) return g.response;
  return NextResponse.json({ payouts: (await boosterFinance(g.user.id)).payouts });
}

const schema = z.object({ currency: z.string().length(3) }).strict();

/** Request a payout of all AVAILABLE earnings in one currency. */
export async function POST(req: Request) {
  const g = await requireRole("BOOSTER");
  if (!g.ok) return g.response;
  const rl = await sharedRateLimit("payout-request", g.user.id, LIMITS.payoutRequestPerUser);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "currency is required" }, { status: 400 });
  try {
    const payout = await requestPayout(g.user.id, parsed.data.currency);
    return NextResponse.json({ payout: { id: payout.id, amount: payout.amount, currency: payout.currency, status: payout.status } }, { status: 201 });
  } catch (e) {
    return financeErrorResponse(e);
  }
}
