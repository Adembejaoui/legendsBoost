import { NextResponse } from "next/server";
import { z } from "zod";
import { decideFineAppeal, reverseFine } from "@/lib/boosters/discipline";
import { disciplineError, requireRoleUser } from "@/lib/boosters/discipline-http";

const body = z
  .object({ action: z.enum(["accept_appeal", "reject_appeal", "reverse"]), note: z.string().trim().min(3).max(1000) })
  .strict();

/** Admin: decide a fine appeal, or reverse a fine. */
export async function POST(req: Request, { params }: { params: Promise<{ fineId: string }> }) {
  const r = await requireRoleUser("ADMIN");
  if (r.error) return r.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A note is required." }, { status: 400 });
  try {
    const { fineId } = await params;
    const { action, note } = parsed.data;
    const out = action === "reverse" ? await reverseFine(r.user.id, fineId, note) : await decideFineAppeal(r.user.id, fineId, action === "accept_appeal", note);
    return NextResponse.json(out);
  } catch (e) {
    return disciplineError(e);
  }
}
