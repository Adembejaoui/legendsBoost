import { NextResponse } from "next/server";
import { z } from "zod";
import { guardWorkspace } from "@/lib/orders/workspace-guard";
import { confirmByCustomer, disputeByCustomer } from "@/lib/orders/completion-request.service";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("dispute"), reason: z.string().min(10).max(1000) }),
]);

/** Customer answers a completion: confirm it, or report a problem (an admin decides). */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;
  if (g.access.viewerRole !== "customer") return NextResponse.json({ error: "Only the customer can answer this." }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell us what is wrong (at least 10 characters)." }, { status: 400 });
  }
  try {
    if (parsed.data.action === "confirm") {
      await confirmByCustomer(orderId, g.user.id);
      return NextResponse.json({ ok: true, status: "COMPLETED" });
    }
    await disputeByCustomer(orderId, g.user.id, parsed.data.reason);
    return NextResponse.json({ ok: true, status: "DISPUTED" });
  } catch (e) {
    if (e instanceof Error && e.name === "CompletionFlowError") {
      return NextResponse.json({ error: e.message }, { status: (e as Error & { status: number }).status });
    }
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
