import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { allocateEarningByAdmin, approveEarning } from "@/lib/finance/earnings";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }).strict(),
  z
    .object({
      action: z.literal("allocate"),
      note: z.string().min(3).max(500),
      allocations: z.array(z.object({ assignmentId: z.string().min(1), amount: z.number().int().min(0) }).strict()).min(1).max(20),
    })
    .strict(),
]);

/** Admin: approve (release) an earning, or allocate a multi-booster earning. */
export async function POST(req: Request, { params }: { params: Promise<{ earningId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const { earningId } = await params;
    if (parsed.data.action === "approve") {
      const e = await approveEarning(g.user.id, earningId);
      return NextResponse.json({ earning: { id: e.id, status: e.status } });
    }
    const children = await allocateEarningByAdmin(g.user.id, earningId, parsed.data.allocations, parsed.data.note);
    return NextResponse.json({ earnings: children.map((c) => ({ id: c.id, boosterId: c.boosterId, grossAmount: c.grossAmount, status: c.status })) });
  } catch (e) {
    return financeErrorResponse(e);
  }
}
