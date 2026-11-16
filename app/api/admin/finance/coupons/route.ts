import { NextResponse } from "next/server";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { createCoupon, listCouponsWithUsage } from "@/lib/pricing/coupon-admin.service";

/** Admin: discount codes with their use counts. */
export async function GET() {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  return NextResponse.json({ coupons: await listCouponsWithUsage() }, { headers: { "Cache-Control": "no-store" } });
}

/** Admin: create a discount code (platform-funded; never reduces booster pay). */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({ coupon: await createCoupon(g.user.id, await readJson(req)) }, { status: 201 });
  } catch (e) {
    return financeErrorResponse(e);
  }
}
