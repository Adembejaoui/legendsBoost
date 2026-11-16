import { NextResponse } from "next/server";
import { z } from "zod";
import { appealFine } from "@/lib/boosters/discipline";
import { disciplineError, requireRoleUser } from "@/lib/boosters/discipline-http";

const body = z.object({ text: z.string().trim().min(10).max(2000) }).strict();

/** Booster: appeal one of their fines (once). */
export async function POST(req: Request, { params }: { params: Promise<{ fineId: string }> }) {
  const r = await requireRoleUser("BOOSTER");
  if (r.error) return r.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Explain your appeal (at least 10 characters)." }, { status: 400 });
  try {
    const { fineId } = await params;
    return NextResponse.json(await appealFine(r.user.id, fineId, parsed.data.text));
  } catch (e) {
    return disciplineError(e);
  }
}
