import prisma from "@/lib/prisma";
import { createNotificationsForEvent } from "@/lib/notifications/service";
import { sanitizeText, checkRateLimit, SUPPORT_TICKET_RATE_LIMIT } from "@/lib/security/sanitize";
import { DELETED_USER_LABEL } from "@/lib/messages/sender";

import { $Enums } from "@/app/generated/prisma/client";

// Derived from the Prisma schema so the application can never accept a value
// the database enum rejects. (A hand-written union previously included
// "ACCOUNT_ISSUE", which does not exist in the database: such tickets and
// category filters failed inside Prisma with a 500.)
export type SupportTicketCategory = $Enums.SupportTicketCategory;
export type SupportTicketPriority = $Enums.SupportTicketPriority;
export type SupportTicketStatus = $Enums.SupportTicketStatus;

export const SUPPORT_TICKET_CATEGORIES = Object.values($Enums.SupportTicketCategory) as SupportTicketCategory[];
export const SUPPORT_TICKET_PRIORITIES = Object.values($Enums.SupportTicketPriority) as SupportTicketPriority[];

export function isSupportTicketCategory(value: unknown): value is SupportTicketCategory {
  return typeof value === "string" && (SUPPORT_TICKET_CATEGORIES as string[]).includes(value);
}

export function isSupportTicketPriority(value: unknown): value is SupportTicketPriority {
  return typeof value === "string" && (SUPPORT_TICKET_PRIORITIES as string[]).includes(value);
}

export const SUPPORT_TICKET_STATUSES = Object.values($Enums.SupportTicketStatus) as SupportTicketStatus[];

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && (SUPPORT_TICKET_STATUSES as string[]).includes(value);
}

// Valid support ticket status transitions
export const SUPPORT_TICKET_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"], // Can reopen if customer responds
  CLOSED: ["IN_PROGRESS"], // Can reopen if new issue arises
};

export function validateSupportTicketTransition(from: SupportTicketStatus, to: SupportTicketStatus): void {
  const allowed = SUPPORT_TICKET_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid ticket status transition: ${from} -> ${to}. Allowed: ${allowed.join(", ")}`);
  }
}

export async function createSupportTicket(
  customerId: string,
  data: {
    orderId?: string;
    subject: string;
    description: string;
    category: SupportTicketCategory;
    priority?: SupportTicketPriority;
  }
) {
  // A ticket may only reference the customer's OWN order (otherwise any
  // order id could be attached and its details returned with the ticket).
  if (data.orderId) {
    const order = await prisma.order.findUnique({ where: { id: data.orderId }, select: { userId: true } });
    if (!order || order.userId !== customerId) throw new Error("Order not found");
  }

  // Rate limiting (the only place ticket creation is counted)
  const rateLimit = checkRateLimit(customerId, SUPPORT_TICKET_RATE_LIMIT);
  if (!rateLimit.allowed) {
    throw new Error(`Rate limit exceeded. Try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}`);
  }

  // Sanitize inputs
  const sanitizedSubject = sanitizeText(data.subject);
  const sanitizedDescription = sanitizeText(data.description);

  const ticket = await prisma.supportTicket.create({
    data: {
      customerId,
      orderId: data.orderId ?? null,
      subject: sanitizedSubject,
      description: sanitizedDescription,
      category: data.category,
      priority: data.priority ?? "MEDIUM",
      status: "OPEN",
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      order: { select: { id: true, gameSlug: true, serviceSlug: true, status: true } },
    },
  });

  await prisma.supportMessage.create({
    data: {
      ticketId: ticket.id,
      senderId: customerId,
      content: sanitizedDescription,
      isAdminReply: false,
    },
  });

  await createNotificationsForEvent({
    type: "SUPPORT_TICKET_CREATED",
    ticketId: ticket.id,
    metadata: {
      ticketSubject: ticket.subject,
      ticketCategory: ticket.category,
      ticketPriority: ticket.priority,
    },
    actorId: customerId,
  });

  return ticket;
}

export async function getSupportTickets(
  userId: string,
  userRole: string,
  options: {
    page?: number;
    limit?: number;
    status?: SupportTicketStatus;
    category?: SupportTicketCategory;
    priority?: SupportTicketPriority;
  } = {}
) {
  const { page = 1, limit = 20, status, category, priority } = options;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (userRole === "ADMIN") {
    // Admin can see all tickets
  } else {
    where.customerId = userId;
  }

  if (status) where.status = status;
  if (category) where.category = category;
  if (priority) where.priority = priority;

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        customer: { select: { id: true, name: true, email: true } },
        order: { select: { id: true, gameSlug: true, serviceSlug: true, status: true } },
        assignedAdmin: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return { tickets, total };
}

export async function getSupportTicket(
  ticketId: string,
  userId: string,
  userRole: string
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      order: { select: { id: true, gameSlug: true, serviceSlug: true, status: true, userId: true } },
      assignedAdmin: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          sender: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });

  if (!ticket) return null;

  if (userRole !== "ADMIN" && ticket.customerId !== userId) {
    return null;
  }

  return ticket;
}

export async function addSupportMessage(
  ticketId: string,
  senderId: string,
  content: string,
  isAdminReply: boolean
) {
  if (!content.trim()) {
    throw new Error("Message cannot be empty");
  }

  if (content.length > 5000) {
    throw new Error("Message too long (max 5000 characters)");
  }

  // Rate limiting is done once, by the API route (counting here as well
  // halved the documented limit).

  // Sanitize content
  const sanitizedContent = sanitizeText(content.trim());

  const message = await prisma.supportMessage.create({
    data: {
      ticketId,
      senderId,
      content: sanitizedContent,
      isAdminReply,
    },
    include: {
      sender: { select: { id: true, name: true, image: true } },
    },
  });

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { customerId: true, assignedAdminId: true, subject: true },
  });

  if (isAdminReply) {
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "IN_PROGRESS", updatedAt: new Date() },
    });
  } else {
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "WAITING_FOR_CUSTOMER", updatedAt: new Date() },
    });
  }

  await createNotificationsForEvent({
    type: "SUPPORT_REPLY",
    ticketId,
    metadata: {
      isAdminReply,
      ticketSubject: ticket?.subject ?? "",
    },
    actorId: senderId,
  });

  return message;
}

export async function updateSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
  adminId: string
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { customerId: true, assignedAdminId: true, subject: true, status: true },
  });

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  // Validate status transition
  validateSupportTicketTransition(ticket.status, status);

  const updateData: any = { status, updatedAt: new Date() };
  if (status === "RESOLVED" || status === "CLOSED") {
    updateData.resolvedAt = new Date();
  }

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: updateData,
  });

  await createNotificationsForEvent({
    type: "SUPPORT_STATUS_UPDATED",
    ticketId,
    metadata: {
      newStatus: status,
      ticketSubject: ticket.subject,
    },
    actorId: adminId,
  });

  if (status === "RESOLVED") {
    await createNotificationsForEvent({
      type: "SUPPORT_TICKET_RESOLVED",
      ticketId,
      metadata: {
        ticketSubject: ticket.subject,
      },
      actorId: adminId,
    });
  }

  return { success: true };
}

export async function assignSupportTicket(
  ticketId: string,
  adminId: string
) {
  // Verify the user is an admin
  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true },
  });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Only admins can be assigned to tickets");
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
  });
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { assignedAdminId: adminId, status: "IN_PROGRESS", updatedAt: new Date() },
  });

  await createNotificationsForEvent({
    type: "SUPPORT_STATUS_UPDATED",
    ticketId,
    metadata: {
      newStatus: "IN_PROGRESS",
      ticketSubject: ticket.subject,
      assignedAdminId: adminId,
    },
    actorId: adminId,
  });

  return updated;
}