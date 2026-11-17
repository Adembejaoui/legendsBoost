import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guardWorkspace } from "@/lib/orders/workspace-guard";
import { proofStore } from "@/lib/storage/order-proofs";

/**
 * A completion proof screenshot. Same access as the order page (customer,
 * the order's booster, admins); the image comes from the private bucket.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string; proofId: string }> }) {
  const { orderId, proofId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;

  const proof = await prisma.orderCompletionProof.findUnique({
    where: { id: proofId },
    select: { orderId: true, storagePath: true, contentType: true },
  });
  if (!proof || proof.orderId !== orderId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await proofStore().get(proof.storagePath).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": proof.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
