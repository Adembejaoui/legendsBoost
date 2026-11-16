import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { approvePayout, markPayoutFailed, markPayoutProcessing, recordPayoutPaid, rejectPayout } from "@/lib/finance/payouts";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }).strict(),
  z.object({ action: z.literal("processing") }).strict(),
  z
    .object({
      action: z.literal("paid"),
      method: z.string().trim().min(1).max(64),
      externalReference: z.string().trim().min(1).max(200),
      evidence: z.string().trim().min(3).max(1000),
      paidAt: z.string().datetime().optional(),
    })
    .strict(),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal("fail"), reason: z.string().trim().min(3).max(500) }).strict(),
]);

/** Admin: move a manual payout through its lifecycle. */
export async function POST(req: Request, { params }: { params: Promise<{ payoutId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const { payoutId } = await params;
    const d = parsed.data;
    const payout =
      d.action === "approve"
        ? await approvePayout(g.user.id, payoutId)
        : d.action === "processing"
          ? await markPayoutProcessing(g.user.id, payoutId)
          : d.action === "paid"
            ? await recordPayoutPaid(g.user.id, payoutId, { method: d.method, externalReference: d.externalReference, evidence: d.evidence, paidAt: d.paidAt ? new Date(d.paidAt) : undefined })
            : d.action === "reject"
              ? await rejectPayout(g.user.id, payoutId, d.reason)
              : await markPayoutFailed(g.user.id, payoutId, d.reason);
    return NextResponse.json({ payout: { id: payout.id, status: payout.status } });
  } catch (e) {
    return financeErrorResponse(e);
  }
}
