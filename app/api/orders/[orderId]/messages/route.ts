import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import {
  getOrCreateConversation,
  getMessages,
  getMessagesSince,
  canAccessConversation,
  sendMessage,
  markMessagesAsRead,
} from "@/lib/chat/service";
import { checkRateLimit, MESSAGE_RATE_LIMIT } from "@/lib/security/sanitize";
import { MODERATION_NOTICE } from "@/lib/chat/moderation";

/** Client-generated optimistic id: echoed in the broadcast, never persisted. */
const CLIENT_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { orderId } = await params;

    const canAccess = await canAccessConversation(user.id, user.role ?? "CUSTOMER", orderId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const conversation = await getOrCreateConversation(orderId);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
    const markRead = searchParams.get("markRead") !== "false";

    // Catch-up mode used by the realtime client after (re)subscribing:
    // everything created at or after `after`, oldest first.
    const afterParam = searchParams.get("after");
    if (afterParam) {
      const after = new Date(afterParam);
      if (Number.isNaN(after.getTime())) {
        return NextResponse.json({ error: "Invalid 'after' timestamp" }, { status: 400 });
      }
      const messages = await getMessagesSince(conversation.id, after, limit);
      if (markRead) await markMessagesAsRead(conversation.id, user.id, orderId);
      return NextResponse.json({
        conversationId: conversation.id,
        messages,
        hasMore: messages.length === limit,
        limit,
      });
    }

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const beforeParam = searchParams.get("before");
    let before: string | undefined;
    if (beforeParam) {
      if (Number.isNaN(new Date(beforeParam).getTime())) {
        return NextResponse.json({ error: "Invalid 'before' timestamp" }, { status: 400 });
      }
      before = beforeParam;
    }

    const result = await getMessages(conversation.id, { page, limit, before });

    if (markRead) await markMessagesAsRead(conversation.id, user.id, orderId);

    return NextResponse.json({
      conversationId: conversation.id,
      messages: result.messages,
      total: result.total,
      page,
      limit,
    });
  } catch (err) {
    console.error("[api/orders/messages] GET failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { orderId } = await params;

    const canAccess = await canAccessConversation(user.id, user.role ?? "CUSTOMER", orderId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Rate limiting
    const rateLimit = checkRateLimit(user.id, MESSAGE_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}` },
        { status: 429, headers: { "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString() } }
      );
    }

    const body = await req.json().catch(() => null);
    const content = typeof body?.content === "string" ? body.content.trim() : "";

    if (!content) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    if (content.length > 5000) {
      return NextResponse.json({ error: "Message too long (max 5000 characters)" }, { status: 400 });
    }

    const clientMessageId =
      typeof body?.clientMessageId === "string" && CLIENT_MESSAGE_ID_RE.test(body.clientMessageId)
        ? body.clientMessageId
        : null;

    const conversation = await getOrCreateConversation(orderId);

    const message = await sendMessage(conversation.id, user.id, content, orderId, clientMessageId, { senderRole: user.role });
    const moderated = (message.moderated?.length ?? 0) > 0;

    return NextResponse.json(
      { message, clientMessageId, ...(moderated ? { moderated: true, notice: MODERATION_NOTICE } : {}) },
      { status: 201 }
    );
  } catch (err: any) {
    if (err.message === "Message cannot be empty") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err.message === "Message too long (max 5000 characters)") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err.message?.includes("Rate limit exceeded")) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error("[api/orders/messages] POST failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
