import { NextResponse } from "next/server";
import { requireRole } from "@/lib/finance/http";
import { PokeError, pokeBooster } from "@/lib/orders/poke.service";

/** Customer: email the booster holding the order (at most once per hour). */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const g = await requireRole("CUSTOMER");
  if (!g.ok) return g.response;
  try {
    const { orderId } = await params;
    const r = await pokeBooster(g.user.id, orderId);
    return NextResponse.json({ nextPokeAt: r.nextPokeAt.toISOString() }, { status: 201 });
  } catch (e) {
    if (e instanceof PokeError) {
      return NextResponse.json({ error: e.message, nextPokeAt: e.nextPokeAt?.toISOString() ?? null }, { status: e.status });
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
