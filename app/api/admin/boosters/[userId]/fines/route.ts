import { NextResponse } from "next/server";
import { z } from "zod";
import { issueFine } from "@/lib/boosters/discipline";
import { disciplineError, requireRoleUser } from "@/lib/boosters/discipline-http";

const body = z
  .object({
    orderId: z.string().min(1).max(64),
    code: z.string().min(2).max(40),
    amount: z.number().int().positive().max(1_000_000).optional(),
    note: z.string().trim().min(5).max(1000),
  })
  .strict();

/** Admin: fine a booster (schedule rule, amount in minor units, note shown to the booster). */
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const r = await requireRoleUser("ADMIN");
  if (r.error) return r.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const { userId } = await params;
    const fine = await issueFine(r.user.id, { boosterId: userId, ...parsed.data });
    return NextResponse.json({ fine: { id: fine.id, amount: fine.amount, currency: fine.currency } }, { status: 201 });
  } catch (e) {
    return disciplineError(e);
  }
}
