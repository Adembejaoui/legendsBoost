import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { setCouponActive } from "@/lib/pricing/coupon-admin.service";

const body = z.object({ active: z.boolean() }).strict();

/** Admin: activate / deactivate a code (codes are never deleted). */
export async function PATCH(req: Request, { params }: { params: Promise<{ couponId: string }> }) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    const { couponId } = await params;
    return NextResponse.json({ coupon: await setCouponActive(g.user.id, couponId, parsed.data.active) });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    return financeErrorResponse(e);
  }
}
