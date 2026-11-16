import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { DraftOrderError, republishDraftOrder } from "@/lib/orders/draft-admin.service";

const bodySchema = z.object({
  confirm: z.literal(true),
  note: z.string().trim().max(500).optional(),
});

/** Admin: explicitly republish a DRAFT order to the marketplace (PENDING). */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Republishing must be explicitly confirmed." }, { status: 400 });
  }
  try {
    const { orderId } = await params;
    const order = await republishDraftOrder(orderId, user.id, parsed.data.note);
    return NextResponse.json({ order: { id: order.id, status: order.status } });
  } catch (error) {
    if (error instanceof DraftOrderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to republish order" }, { status: 500 });
  }
}
