import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guardWorkspace } from "@/lib/orders/workspace-guard";

/** Lightweight change probe used by the workspace to refresh itself. */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, updatedAt: true, riotAccount: { select: { updatedAt: true } } },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const version = [order.status, order.updatedAt.getTime(), order.riotAccount?.updatedAt.getTime() ?? 0].join(":");
  return NextResponse.json({ status: order.status, version }, { headers: { "Cache-Control": "no-store" } });
}
