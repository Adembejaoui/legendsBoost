import { NextResponse } from "next/server";
import { requireRole, readJson } from "@/lib/finance/http";
import { BoosterChangeError, decideBoosterChange } from "@/lib/orders/booster-change.service";

/** Admin: approve (release the booster, order back to the marketplace) or reject (note required) a booster change request. */
export async function POST(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    const { requestId } = await params;
    return NextResponse.json(await decideBoosterChange(g.user.id, requestId, await readJson(req)));
  } catch (e) {
    if (e instanceof BoosterChangeError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
