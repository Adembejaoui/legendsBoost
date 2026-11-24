import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireRole, readJson } from "@/lib/finance/http";
import { adjustCashback, CashbackError } from "@/lib/cashback/service";
import { SITE_CURRENCIES } from "@/lib/currency/currencies";
import { logger } from "@/lib/logger";

const Body = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    currency: z.enum(SITE_CURRENCIES),
    /** Minor units, signed: + adds credit, - removes it. */
    amount: z.number().int().refine((n) => n !== 0, "Enter an amount."),
    note: z.string().trim().min(3).max(300),
  })
  .strict();

/** Admin: add or remove a customer's cashback, with a reason (audited). */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { email, currency, amount, note } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "No account with this email." }, { status: 404 });
  try {
    const r = await adjustCashback({ adminId: g.user.id, userId: user.id, currency, amount, note });
    return NextResponse.json({ ok: true, available: r.available }, { status: 201 });
  } catch (e) {
    if (e instanceof CashbackError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("Cashback adjustment failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
