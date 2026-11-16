import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { DraftOrderError, updateDraftOrder } from "@/lib/orders/draft-admin.service";

const patchSchema = z
  .object({
    configuration: z.record(z.string(), z.unknown()).optional(),
    selectedOptions: z.array(z.string().max(64)).max(50).optional(),
    selectedMode: z.enum(["solo", "duo"]).nullable().optional(),
    championsRoles: z
      .object({ roles: z.array(z.string().max(32)).max(5), champions: z.array(z.string().max(64)).max(20) })
      .nullable()
      .optional(),
    price: z.string().trim().nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** Admin: edit a DRAFT order. */
export async function PATCH(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  try {
    const { orderId } = await params;
    const order = await updateDraftOrder(orderId, user.id, parsed.data);
    return NextResponse.json({ order: { id: order.id, status: order.status } });
  } catch (error) {
    if (error instanceof DraftOrderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
}
