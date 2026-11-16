import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { canAccessConversation } from "@/lib/chat/service";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

type TypingEvent = "started" | "stopped";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await params;

    const canAccess = await canAccessConversation(
      user.id,
      user.role ?? "CUSTOMER",
      orderId
    );
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Rate limit typing indicators per user per order (noisy by nature).
    const { success } = await rateLimit(`typing:${orderId}:${user.id}`, {
      windowMs: 60_000,
      maxRequests: 120,
    });
    if (!success) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      event?: TypingEvent;
    };
    const event = body.event;

    if (event !== "started" && event !== "stopped") {
      return NextResponse.json(
        { error: "Invalid typing event" },
        { status: 400 }
      );
    }

    // Ephemeral broadcast: not persisted. Delivered to authorized order
    // channel participants only.
    await broadcastToOrder({
      orderId,
      event: `chat.typing.${event}`,
      payload: {
        orderId,
        userId: user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Typing indicator failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
