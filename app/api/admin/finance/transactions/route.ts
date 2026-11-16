import { NextResponse } from "next/server";
import { requireRole } from "@/lib/finance/http";
import { listTransactions } from "@/lib/finance/queries";

/** Admin: ledger history, newest first, optionally per order or booster. */
export async function GET(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const result = await listTransactions({
    orderId: sp.get("orderId") ?? undefined,
    boosterId: sp.get("boosterId") ?? undefined,
    cursor: sp.get("cursor") ?? undefined,
    take: sp.get("take") ? Number(sp.get("take")) : undefined,
  });
  return NextResponse.json(result);
}
