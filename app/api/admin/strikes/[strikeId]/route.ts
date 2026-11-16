import { NextResponse } from "next/server";
import { z } from "zod";
import { removeStrike } from "@/lib/boosters/discipline";
import { disciplineError, requireRoleUser } from "@/lib/boosters/discipline-http";

const body = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

/** Admin: remove a strike (with a reason, audited). */
export async function DELETE(req: Request, { params }: { params: Promise<{ strikeId: string }> }) {
  const r = await requireRoleUser("ADMIN");
  if (r.error) return r.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give a reason." }, { status: 400 });
  try {
    const { strikeId } = await params;
    return NextResponse.json(await removeStrike(r.user.id, strikeId, parsed.data.reason));
  } catch (e) {
    return disciplineError(e);
  }
}
