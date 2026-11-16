import prisma from "@/lib/prisma";
import { broadcastToOrder } from "@/lib/realtime/broadcast";
import { createNotification, createNotificationsForEvent } from "@/lib/notifications/service";
import { moderateChatText, type ModerationKind } from "./moderation";
import { sanitizeText } from "@/lib/security/sanitize";
import { DELETED_USER_LABEL } from "@/lib/messages/sender";

export async function getOrCreateConversation(orderId: string) {
  let conversation = await prisma.orderConversation.findUnique({
    where: { orderId },
  });

  if (!conversation) {
    conversation = await prisma.orderConversation.create({
      data: { orderId },
    });
  }

  return conversation;
}

export async function getConversation(orderId: string) {
  return prisma.orderConversation.findUnique({
    where: { orderId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 50,
        include: {
          sender: {
            select: { id: true, name: true, image: true },
          },
        },
      },
    },
  });
}

export async function getMessages(
  conversationId: string,
  options: { page?: number; limit?: number; before?: string } = {}
) {
  const { page = 1, limit = 50, before } = options;
  const skip = (page - 1) * limit;

  const where: any = { conversationId };
  if (before) {
    where.createdAt = { lt: new Date(before) };
  }

  const [messages, total] = await Promise.all([
    prisma.orderMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        sender: {
          select: { id: true, name: true, image: true },
        },
      },
    }),
    prisma.orderMessage.count({ where }),
  ]);

  return { messages: messages.reverse(), total };
}

/**
 * Catch-up query used by the realtime client after (re)subscribing.
 *
 * Returns messages with `createdAt >= after`, oldest first. The bound is
 * inclusive on purpose: two messages can share a millisecond timestamp, and
 * the client dedupes by id, so an inclusive cursor can never skip a message.
 */
export async function getMessagesSince(
  conversationId: string,
  after: Date,
  limit = 100
) {
  return prisma.orderMessage.findMany({
    where: { conversationId, createdAt: { gte: after } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
    },
  });
}

export async function canAccessConversation(userId: string, userRole: string, orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      assignments: {
        where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"] } },
        select: { boosterId: true },
      },
    },
  });

  if (!order) return false;

  if (order.userId === userId) return true;
  if (userRole === "ADMIN") return true;

  const activeAssignment = order.assignments[0];
  if (activeAssignment?.boosterId === userId) return true;

  return false;
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string,
  orderId: string,
  clientMessageId: string | null = null,
  opts: { senderRole?: string | null } = {}
) {
  if (!content.trim()) {
    throw new Error("Message cannot be empty");
  }

  if (content.length > 5000) {
    throw new Error("Message too long (max 5000 characters)");
  }

  // Contact / payment details are hidden before anything is stored or
  // shown (admins exempt); the original goes to ChatModerationFlag.
  const raw = content.trim();
  const moderation = opts.senderRole === "ADMIN" ? { text: raw, kinds: [] as ModerationKind[] } : moderateChatText(raw);

  // Sanitize content to prevent XSS
  const sanitizedContent = sanitizeText(moderation.text);

  const message = await prisma.orderMessage.create({
    data: {
      conversationId,
      senderId,
      content: sanitizedContent,
      messageType: "text",
    },
    include: {
      sender: {
        select: { id: true, name: true, image: true },
      },
    },
  });

  await prisma.orderConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  if (moderation.kinds.length > 0) {
    await flagMessage({ orderId, messageId: message.id, senderId, kinds: moderation.kinds, original: raw });
  }

  // Broadcast only after the database write has committed. A broadcast
  // failure does not roll back the persisted message; it remains available
  // through the history API for reconnect recovery.
  await broadcastToOrder({
    orderId,
    event: "chat.message.created",
    payload: {
      messageId: message.id,
      conversationId: message.conversationId,
      orderId,
      senderId: message.senderId,
      senderName: message.sender?.name ?? null,
      senderImage: message.sender?.image ?? null,
      content: message.content,
      messageType: message.messageType,
      createdAt: message.createdAt.toISOString(),
      clientMessageId,
    },
  });

  // The message is already committed. A notification failure must not surface
  // as a send failure, otherwise the client retries and the message is
  // persisted twice.
  try {
    await createNotificationsForEvent({
      type: "NEW_MESSAGE",
      orderId,
      metadata: {
        senderName: message.sender?.name ?? DELETED_USER_LABEL,
        messageId: message.id,
      },
      actorId: senderId,
    });
  } catch (error) {
    console.error(
      "[chat] failed to create NEW_MESSAGE notifications",
      error instanceof Error ? error.message : String(error)
    );
  }

  return Object.assign(message, { moderated: moderation.kinds });
}

/** Keep the original for admins, record an order event, notify admins. Never throws. */
async function flagMessage(f: { orderId: string; messageId: string; senderId: string; kinds: ModerationKind[]; original: string }) {
  try {
    await prisma.chatModerationFlag.create({
      data: { orderId: f.orderId, messageId: f.messageId, senderId: f.senderId, kinds: f.kinds, original: f.original.slice(0, 5000) },
    });
    await prisma.orderEvent.create({
      data: { orderId: f.orderId, type: "CHAT_MESSAGE_FLAGGED", message: "Contact or payment details were hidden in a chat message", metadata: { messageId: f.messageId, senderId: f.senderId, kinds: f.kinds } },
    });
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await Promise.all(
      admins.map((a) =>
        createNotification(a.id, "CHAT_FLAGGED", f.orderId, { kinds: f.kinds.map((k) => k.toLowerCase()).join(", ") }, f.senderId, {
          dedupeKey: `chat-flag:${f.messageId}`,
        })
      )
    );
  } catch (error) {
    console.error("[chat] failed to record a moderation flag", error instanceof Error ? error.message : String(error));
  }
}

export async function markMessagesAsRead(
  conversationId: string,
  userId: string,
  orderId: string
) {
  const unread = await prisma.orderMessage.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      readAt: null,
    },
    select: { id: true },
  });

  await prisma.orderMessage.updateMany({
    where: {
      conversationId,
      senderId: { not: userId },
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  if (unread.length > 0) {
    const readAt = new Date().toISOString();
    await broadcastToOrder({
      orderId,
      event: "chat.message.read",
      payload: {
        conversationId,
        orderId,
        readerId: userId,
        readAt,
        messageIds: unread.map((m) => m.id),
      },
    });
  }
}

export async function getUnreadMessageCount(conversationId: string, userId: string): Promise<number> {
  return prisma.orderMessage.count({
    where: {
      conversationId,
      senderId: { not: userId },
      readAt: null,
    },
  });
}