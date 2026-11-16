import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireRole } from "@/lib/finance/http";

/** Admin: open cancellation requests, oldest first. */
export async function GET() {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const requests = await prisma.orderCancellationRequest.findMany({
    where: { status: "REQUESTED" },
    orderBy: { createdAt: "asc" },
    include: { order: { select: { id: true, status: true, gameSlug: true, serviceSlug: true, pricingSnapshot: { select: { totalAmount: true, currency: true } } } } },
  });
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}
