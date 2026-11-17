import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { adminAcceptCompletion, adminSendBack } from "@/lib/orders/completion-request.service";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal("send_back"), note: z.string().min(5).max(1000) }),
]);

/** Admin decision on a completion: complete the order, or send it back to the booster. */
export async function POST(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { requestId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a note for the booster (at least 5 characters)." }, { status: 400 });
  try {
    if (parsed.data.action === "accept") {
      await adminAcceptCompletion(requestId, user.id, parsed.data.note ?? null);
      return NextResponse.json({ ok: true, status: "COMPLETED" });
    }
    await adminSendBack(requestId, user.id, parsed.data.note);
    return NextResponse.json({ ok: true, status: "IN_PROGRESS" });
  } catch (e) {
    if (e instanceof Error && e.name === "CompletionFlowError") {
      return NextResponse.json({ error: e.message }, { status: (e as Error & { status: number }).status });
    }
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
