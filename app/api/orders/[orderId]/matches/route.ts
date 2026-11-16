import { NextResponse } from "next/server";
import { guardWorkspace } from "@/lib/orders/workspace-guard";
import { getOrderMatchPage } from "@/lib/orders/workspace-data";

/** Paginated matches attributed to THIS order only (never raw history). */
export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;

    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor");
    if (cursor && !/^[a-z0-9]{10,40}$/i.test(cursor)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    const limit = Number(url.searchParams.get("limit") ?? 10) || 10;
    return NextResponse.json(await getOrderMatchPage(orderId, { cursor, limit }));
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
