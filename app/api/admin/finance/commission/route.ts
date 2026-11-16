import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { createCommissionPolicy } from "@/lib/pricing/admin.service";
import { getActiveCommissionPolicy } from "@/lib/pricing/service";

export async function GET() {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const [active, history] = await Promise.all([
    getActiveCommissionPolicy(),
    prisma.commissionPolicy.findMany({ orderBy: { effectiveFrom: "desc" }, take: 50 }),
  ]);
  return NextResponse.json({ active, history });
}

const schema = z
  .object({
    platformFeeBps: z.number().int().min(0).max(10_000),
    effectiveFrom: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
    confirm: z.literal(true),
  })
  .strict();

/** Admin: commission for FUTURE orders. Existing orders keep their snapshot. */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const policy = await createCommissionPolicy(g.user.id, {
      platformFeeBps: parsed.data.platformFeeBps,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : undefined,
      note: parsed.data.note,
    });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (e) {
    return financeErrorResponse(e);
  }
}
