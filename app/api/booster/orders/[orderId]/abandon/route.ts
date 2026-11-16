import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { rejectIfAssignmentNotInOrder } from "@/lib/assignments/route-guard";
import { abandonOrder, ABANDON_REASON_MAX_LENGTH } from "@/lib/assignments/service";

const bodySchema = z.object({
  assignmentId: z.string().min(1),
  reason: z.string().trim().min(3, "Please give a short reason").max(ABANDON_REASON_MAX_LENGTH),
});

/**
 * Assigned booster abandons the order. The order moves to DRAFT (admin
 * review); it does not return to the marketplace.
 */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { orderId } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    const mismatch = await rejectIfAssignmentNotInOrder(parsed.data.assignmentId, orderId);
    if (mismatch) return mismatch;

    const result = await abandonOrder(parsed.data.assignmentId, user.id, parsed.data.reason);
    return NextResponse.json({ assignment: result.assignment, orderStatus: "DRAFT" });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "NotBoosterOwnerError" || error.name === "BoosterNotEligibleError") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.name === "OrderStateConflictError") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error.name === "InvalidOrderTransitionError" || error.message.startsWith("Cannot abandon")) {
        return NextResponse.json({ error: "This order can no longer be abandoned." }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Failed to abandon order" }, { status: 400 });
  }
}
