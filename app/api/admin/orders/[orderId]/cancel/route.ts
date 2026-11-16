import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import {
  cancelDraftOrder,
  DRAFT_CANCEL_REASON_MAX_LENGTH,
  DRAFT_CANCEL_REASON_MIN_LENGTH,
  DraftOrderError,
} from "@/lib/orders/draft-admin.service";

const bodySchema = z.object({
  confirm: z.literal(true),
  reason: z
    .string()
    .trim()
    .min(DRAFT_CANCEL_REASON_MIN_LENGTH, "A cancellation reason is required.")
    .max(DRAFT_CANCEL_REASON_MAX_LENGTH),
});

/** Admin: cancel a DRAFT (abandoned) order. Reason and confirmation required. */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const missingConfirm = parsed.error.issues.some((i) => i.path[0] === "confirm");
    return NextResponse.json(
      { error: missingConfirm ? "Cancellation must be explicitly confirmed." : parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  try {
    const { orderId } = await params;
    const order = await cancelDraftOrder(orderId, user.id, parsed.data.reason);
    return NextResponse.json({ order: { id: order.id, status: order.status } });
  } catch (error) {
    if (error instanceof DraftOrderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to cancel order" }, { status: 500 });
  }
}
