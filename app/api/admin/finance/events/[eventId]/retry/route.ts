import { NextResponse } from "next/server";
import { requireRole } from "@/lib/finance/http";
import { processStoredEvent } from "@/lib/payments/webhook.service";
import { dispatchOutbox } from "@/lib/payments/outbox";
import { writeAudit } from "@/lib/finance/audit";
import prisma from "@/lib/prisma";

/** Admin: re-process a stored (already signature-verified) Stripe event. */
export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const { eventId } = await params;
  const row = await prisma.paymentEvent.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!row) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const result = await processStoredEvent(row.id);
  await prisma.$transaction((tx) =>
    writeAudit(tx, { actorId: g.user.id, action: "PAYMENT_EVENT_RETRIED", entityType: "paymentEvent", entityId: row.id, details: result })
  );
  await dispatchOutbox({ limit: 20 });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
