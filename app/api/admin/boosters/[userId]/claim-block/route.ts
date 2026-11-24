import { NextResponse } from "next/server";
import { z } from "zod";
import { liftClaimBlock } from "@/lib/boosters/discipline";
import { disciplineError, requireRoleUser } from "@/lib/boosters/discipline-http";

const body = z.object({ note: z.string().trim().min(3).max(500) }).strict();

/** Admin: lift the automatic claim block (repeated orders taken back for inactivity). Audited. */
export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const r = await requireRoleUser("ADMIN");
  if (r.error) return r.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give a reason." }, { status: 400 });
  try {
    const { userId } = await params;
    return NextResponse.json(await liftClaimBlock(r.user.id, userId, parsed.data.note));
  } catch (e) {
    return disciplineError(e);
  }
}
