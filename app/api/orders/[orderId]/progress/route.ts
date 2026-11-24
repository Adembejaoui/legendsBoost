import { NextResponse } from "next/server";
import { z } from "zod";
import { guardWorkspace } from "@/lib/orders/workspace-guard";
import { postProgressUpdate } from "@/lib/orders/progress-updates.service";

// A rank (rank orders) or the games done so far (Net Win / Placement Boost).
const Body = z.union([
  z.object({
    tierId: z.string().min(1).max(40),
    divisionId: z.string().max(10).nullable().optional(),
    lp: z.number().int().min(0).max(5000).nullable().optional(),
  }),
  z.object({ gamesDone: z.number().int().min(0).max(1000) }),
]);

/** The working booster reports the account's current rank (replaces Riot tracking). */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;
  if (g.access.viewerRole !== "booster") return NextResponse.json({ error: "Only the booster can update the progress." }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose the current rank or the games done." }, { status: 400 });
  try {
    const r = await postProgressUpdate({ orderId, boosterId: g.user.id, ...parsed.data });
    return NextResponse.json({ ok: true, update: r });
  } catch (e) {
    if (e instanceof Error && e.name === "ProgressUpdateError") {
      return NextResponse.json({ error: e.message }, { status: (e as Error & { status: number }).status });
    }
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
