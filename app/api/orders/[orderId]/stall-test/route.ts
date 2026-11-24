import { NextResponse } from "next/server";
import { z } from "zod";
import { guardWorkspace } from "@/lib/orders/workspace-guard";
import { runStallTestStep, STALL_TEST_STEPS, StallTestError, stallTestToolsEnabled } from "@/lib/boosters/stall";
import { logger } from "@/lib/logger";

const Body = z.object({ step: z.enum(STALL_TEST_STEPS) }).strict();

/**
 * Test tool (STALL_TEST_TOOLS=1 only): the order's customer runs one stalled
 * order step now. Answers 404 when the tools are off, so nothing is exposed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  if (!stallTestToolsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { orderId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;
  if (g.access.viewerRole !== "customer") return NextResponse.json({ error: "Only the customer of this order can use the test tool." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  try {
    const r = await runStallTestStep(orderId, g.user.id, parsed.data.step);
    logger.info("Stall test step", { orderId, step: parsed.data.step, done: r.done });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof StallTestError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("Stall test step failed", { orderId, error: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
