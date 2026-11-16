import prisma from "@/lib/prisma";
import { broadcastToUser } from "@/lib/realtime/broadcast";
import {
  NotificationEvent,
  NotificationEventType,
  NotificationRecipientRule,
  NOTIFICATION_TITLES,
  NOTIFICATION_MESSAGES,
  storedNotificationType,
  NotificationEventMetadata,
} from "./types";
import { Prisma } from "@/app/generated/prisma/client";

export interface CreateNotificationOptions {
  /** Deliver even when the recipient is the actor. */
  includeActor?: boolean;
  /** Per-recipient idempotency key; a duplicate is silently skipped. */
  dedupeKey?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function createNotification(
  userId: string,
  type: NotificationEventType,
  orderId: string | undefined,
  metadata?: NotificationEventMetadata,
  actorId?: string,
  options: CreateNotificationOptions = {}
): Promise<void> {
  if (actorId && userId === actorId && !options.includeActor) {
    return;
  }

  // Callers rarely repeat the orderId inside metadata, which left messages
  // reading "Order # has been ...". Always make it available to templates.
  const meta: NotificationEventMetadata | undefined =
    orderId && !metadata?.orderId ? { ...(metadata ?? {}), orderId } : metadata;

  const title = NOTIFICATION_TITLES[type];
  const message = NOTIFICATION_MESSAGES[type](meta);

  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId,
        type: storedNotificationType(type),
        title,
        message,
        orderId,
        metadata: meta as Prisma.InputJsonValue,
        read: false,
        dedupeKey: options.dedupeKey ?? null,
      },
    });
  } catch (error) {
    // Already delivered under this idempotency key: not an error.
    if (options.dedupeKey && isUniqueViolation(error)) return;
    throw error;
  }

  // Broadcast real-time notification to the recipient's private user channel.
  // Persisted first; broadcast failure does not remove the notification.
  broadcastToUser({
    userId,
    event: "notification.created",
    payload: {
      notificationId: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      orderId: notification.orderId,
      createdAt: notification.createdAt.toISOString(),
    },
  });
}

export async function createNotificationsForEvent(event: NotificationEvent): Promise<void> {
  const recipientRules = getRecipientRules();
  const rule = recipientRules.find((r) => r.eventType === event.type);

  if (!rule) {
    return;
  }

  const recipients = Array.from(new Set(await rule.getRecipients(event, prisma)));

  await Promise.all(
    recipients.map((userId) =>
      createNotification(userId, event.type, event.orderId, event.metadata, event.actorId, {
        includeActor: rule.notifyActor === true,
        dedupeKey: event.dedupeKey,
      })
    )
  );
}

async function getAdminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/**
 * The booster on the event's assignment, only if that assignment belongs to
 * the event's order and still holds it (never a released / other booster).
 */
async function activeBoosterOf(event: NotificationEvent): Promise<string[]> {
  if (!event.orderId || !event.assignmentId) return [];
  const assignment = await prisma.orderBoosterAssignment.findUnique({
    where: { id: event.assignmentId },
    select: { boosterId: true, orderId: true, activeOrderId: true },
  });
  if (!assignment || assignment.orderId !== event.orderId || assignment.activeOrderId !== event.orderId) return [];
  return [assignment.boosterId];
}

/** Exposed for tests: the recipient rule table. */
export function __getRecipientRulesForTest(): NotificationRecipientRule[] {
  return getRecipientRules();
}

function getRecipientRules(): NotificationRecipientRule[] {
  return [
    {
      eventType: "ORDER_CREATED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        if (!order) return [];

        const admins = await prisma.user.findMany({
          where: { role: "ADMIN" },
          select: { id: true },
        });

        return [order.userId, ...admins.map((a) => a.id)];
      },
    },
    {
      eventType: "ORDER_CANCELLED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          include: {
            assignments: {
              where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"] } },
              select: { boosterId: true },
            },
          },
        });
        if (!order) return [];

        const recipientIds = [order.userId];
        for (const assignment of order.assignments) {
          if (assignment.boosterId !== event.actorId) {
            recipientIds.push(assignment.boosterId);
          }
        }
        return recipientIds;
      },
    },
    {
      eventType: "ORDER_STARTED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return order ? [order.userId] : [];
      },
    },
    {
      eventType: "ORDER_PROGRESS_UPDATED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return order ? [order.userId] : [];
      },
    },
    {
      // Customer pause / resume: the booster holding the order, only.
      eventType: "ORDER_PAUSED_BY_CUSTOMER",
      getRecipients: (event) => activeBoosterOf(event),
    },
    {
      eventType: "ORDER_RESUMED_BY_CUSTOMER",
      getRecipients: (event) => activeBoosterOf(event),
    },
    {
      // Completion: customer, the booster who completed it, and every admin.
      // notifyActor so the completing booster also gets a persistent record.
      eventType: "ORDER_COMPLETED",
      notifyActor: true,
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        if (!order) return [];
        const recipients = [order.userId];
        if (event.assignmentId) {
          const assignment = await prisma.orderBoosterAssignment.findUnique({
            where: { id: event.assignmentId },
            select: { boosterId: true, orderId: true },
          });
          if (assignment && assignment.orderId === event.orderId) {
            recipients.push(assignment.boosterId);
          }
        }
        return [...recipients, ...(await getAdminIds())];
      },
    },
    {
      eventType: "ORDER_REOPENED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return order ? [order.userId] : [];
      },
    },
    {
      eventType: "BOOSTER_ASSIGNED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        if (!order) return [];

        const assignment = await prisma.orderBoosterAssignment.findUnique({
          where: { id: event.assignmentId },
          select: { boosterId: true },
        });

        const recipients = [order.userId];
        if (assignment?.boosterId && assignment.boosterId !== event.actorId) {
          recipients.push(assignment.boosterId);
        }
        return recipients;
      },
    },
    {
      eventType: "BOOSTER_ACCEPTED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return order ? [order.userId] : [];
      },
    },
    {
      eventType: "BOOSTER_REJECTED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return order ? [order.userId] : [];
      },
    },
    {
      eventType: "BOOSTER_REASSIGNED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        if (!order) return [];

        const newAssignment = await prisma.orderBoosterAssignment.findUnique({
          where: { id: event.assignmentId },
          select: { boosterId: true },
        });

        const admins = await prisma.user.findMany({
          where: { role: "ADMIN" },
          select: { id: true },
        });

        const recipients = [order.userId, ...admins.map((a) => a.id)];
        if (newAssignment?.boosterId && newAssignment.boosterId !== event.actorId) {
          recipients.push(newAssignment.boosterId);
        }
        return recipients;
      },
    },
    {
      eventType: "BOOSTER_REMOVED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return order ? [order.userId] : [];
      },
    },
    {
      // Abandonment moves the order to DRAFT for admin review: admins, and
      // the customer so they know their booster left.
      eventType: "BOOSTER_ABANDONED",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        return [...(order ? [order.userId] : []), ...(await getAdminIds())];
      },
    },
    {
      eventType: "NEW_MESSAGE",
      getRecipients: async (event) => {
        if (!event.orderId) return [];
        const conversation = await prisma.orderConversation.findUnique({
          where: { orderId: event.orderId },
          select: { id: true },
        });
        if (!conversation) return [];

        const order = await prisma.order.findUnique({
          where: { id: event.orderId },
          select: { userId: true },
        });
        if (!order) return [];

        const activeAssignment = await prisma.orderBoosterAssignment.findFirst({
          where: {
            orderId: event.orderId,
            status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"] },
          },
          select: { boosterId: true },
        });

        const recipients: string[] = [];
        if (order.userId !== event.actorId) {
          recipients.push(order.userId);
        }
        if (activeAssignment?.boosterId && activeAssignment.boosterId !== event.actorId) {
          recipients.push(activeAssignment.boosterId);
        }
        return recipients;
      },
    },
    {
      eventType: "SUPPORT_REPLY",
      getRecipients: async (event) => {
        if (!event.ticketId) return [];
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: event.ticketId },
          select: { customerId: true, assignedAdminId: true, subject: true },
        });
        if (!ticket) return [];

        if (event.metadata?.isAdminReply) {
          return ticket.customerId !== event.actorId ? [ticket.customerId] : [];
        } else {
          if (ticket.assignedAdminId && ticket.assignedAdminId !== event.actorId) {
            return [ticket.assignedAdminId];
          }
          const admins = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true },
          });
          return admins.filter((a) => a.id !== event.actorId).map((a) => a.id);
        }
      },
    },
    {
      eventType: "SUPPORT_STATUS_UPDATED",
      getRecipients: async (event) => {
        if (!event.ticketId) return [];
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: event.ticketId },
          select: { customerId: true, assignedAdminId: true, subject: true },
        });
        if (!ticket) return [];

        const recipients: string[] = [];
        if (ticket.customerId !== event.actorId) {
          recipients.push(ticket.customerId);
        }
        if (ticket.assignedAdminId && ticket.assignedAdminId !== event.actorId) {
          recipients.push(ticket.assignedAdminId);
        }
        return recipients;
      },
    },
    {
      eventType: "SUPPORT_TICKET_CREATED",
      getRecipients: async (event) => {
        const admins = await prisma.user.findMany({
          where: { role: "ADMIN" },
          select: { id: true },
        });
        return admins.map((a) => a.id);
      },
    },
    {
      eventType: "SUPPORT_TICKET_RESOLVED",
      getRecipients: async (event) => {
        if (!event.ticketId) return [];
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: event.ticketId },
          select: { customerId: true, subject: true },
        });
        return ticket && ticket.customerId !== event.actorId ? [ticket.customerId] : [];
      },
    },
  ];
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { userId: true, read: true },
  });

  if (!notification || notification.userId !== userId) {
    return;
  }

  if (notification.read) {
    return;
  }

  await prisma.notification.update({
    where: { id: notificationId, userId },
    data: { read: true, readAt: new Date() },
  });

  // Broadcast read receipt to the recipient's private user channel.
  broadcastToUser({
    userId,
    event: "notification.read",
    payload: {
      notificationId,
      readerId: userId,
      readAt: new Date().toISOString(),
    },
  });
}

export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date() },
  });

  // Broadcast that all notifications for this user were marked read.
  broadcastToUser({
    userId,
    event: "notification.all_read",
    payload: {
      userId,
      readAt: new Date().toISOString(),
    },
  });
}

export async function getNotifications(
  userId: string,
  options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
): Promise<{ notifications: any[]; total: number }> {
  const { page = 1, limit = 20, unreadOnly = false } = options;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (unreadOnly) where.read = false;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}