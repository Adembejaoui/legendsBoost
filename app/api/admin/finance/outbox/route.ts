import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, readJson } from "@/lib/finance/http";
import { dispatchOutbox, requeueFailedOutbox } from "@/lib/payments/outbox";

const schema = z.object({ action: z.enum(["dispatch", "requeue-failed"]) }).strict();

/** Admin: run the side-effect dispatcher, or requeue failed side effects. */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const requeued = parsed.data.action === "requeue-failed" ? await requeueFailedOutbox() : 0;
  const result = await dispatchOutbox({ limit: 50 });
  return NextResponse.json({ requeued, ...result });
}
