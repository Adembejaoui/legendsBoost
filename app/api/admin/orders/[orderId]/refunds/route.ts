import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { requestRefund } from "@/lib/finance/refunds";

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const { orderId } = await params;
  const refunds = await prisma.refund.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ refunds });
}

const schema = z
  .object({
    amount: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
    paymentId: z.string().min(1).optional(),
  })
  .strict();

/**
 * Admin: full or partial refund through Stripe. Requires an
 * Idempotency-Key header; a repeated request returns the same refund.
 */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const { orderId } = await params;
    const refund = await requestRefund(g.user.id, {
      orderId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      paymentId: parsed.data.paymentId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
    });
    return NextResponse.json(
      { refund: { id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency, failureReason: refund.failureReason } },
      { status: 201 }
    );
  } catch (e) {
    return financeErrorResponse(e, "Refund failed.");
  }
}
