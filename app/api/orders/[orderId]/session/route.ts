import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { clientIp, endSession, SessionError, startSession } from "@/lib/orders/sessions.service";
import { logger } from "@/lib/logger";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

/**
 * Booster play session on the order's account.
 *   POST   start (body { rulesAccepted: true }); required before the login can be revealed
 *   DELETE end the open session
 */
export const dynamic = "force-dynamic";

const startSchema = z.object({ rulesAccepted: z.literal(true) }).strict();

function errorResponse(e: unknown) {
  if (e instanceof SessionError) return NextResponse.json({ error: e.message }, { status: e.status });
  logger.error("Session request failed", { error: e instanceof Error ? e.name : "unknown" });
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    const rl = await sharedRateLimit("session", g.user.id, LIMITS.sessionPerUser);
    if (!rl.success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    if (g.access.viewerRole !== "booster") return forbidden("Only the booster working on the order can start a session.");
    const parsed = startSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Accept the session rules to start." }, { status: 400 });
    const session = await startSession(orderId, g.user.id, {
      rulesAccepted: true,
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ session: { id: session.id, startedAt: session.startedAt.toISOString() } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    if (g.access.viewerRole !== "booster") return forbidden("Only the booster can end their session.");
    return NextResponse.json(await endSession(orderId, g.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
