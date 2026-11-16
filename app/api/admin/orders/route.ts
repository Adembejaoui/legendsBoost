import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { listDraftOrders } from "@/lib/orders/draft-admin.service";

/** Admin: list DRAFT (abandoned) orders awaiting review. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ orders: await listDraftOrders() });
}
