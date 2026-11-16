import { NextResponse } from "next/server";
import { requireRole } from "@/lib/finance/http";
import { adminFinanceSummary, adminFinanceWorkQueue } from "@/lib/finance/queries";
import { EARNING_RELEASE_POLICY } from "@/lib/finance/earnings";

export async function GET() {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const [summary, queue] = await Promise.all([adminFinanceSummary(), adminFinanceWorkQueue()]);
  return NextResponse.json({ summary, queue, releasePolicy: EARNING_RELEASE_POLICY }, { headers: { "Cache-Control": "no-store" } });
}
