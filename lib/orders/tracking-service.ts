import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

export type DbClient = Prisma.TransactionClient | typeof prisma;

export type OrderEventType =
  | "ORDER_CREATED"
  | "BOOSTER_ASSIGNED"
  | "WORK_STARTED"
  | "ORDER_PAUSED"
  | "ORDER_RESUMED"
  | "COMPLETION_SUBMITTED"
  | "ORDER_COMPLETED"
  | "ORDER_CANCELLED"
  | "CUSTOMER_CONFIRMED"
  // Keep backward compatibility with existing event types
  | "ORDER_CLAIMED"
  | "ASSIGNMENT_ACCEPTED"
  | "ASSIGNMENT_STARTED"
  | "ASSIGNMENT_COMPLETED"
  | "ASSIGNMENT_CANCELLED"
  | "ASSIGNMENT_RELEASED"
  | "ASSIGNMENT_DECLINED"
  // Order workspace lifecycle
  | "BOOSTER_ABANDONED"
  | "ORDER_MOVED_TO_DRAFT"
  | "DRAFT_EDITED"
  | "ORDER_REPUBLISHED"
  | "RIOT_ACCOUNT_UPDATED"
  // Encrypted game-account credentials (never the values themselves)
  | "ACCOUNT_CREDENTIALS_UPDATED"
  | "ACCOUNT_CREDENTIALS_REMOVED"
  | "ACCOUNT_CREDENTIALS_VIEWED";

const VALID_EVENT_TYPES = new Set<OrderEventType>([
  "ORDER_CREATED",
  "BOOSTER_ASSIGNED",
  "WORK_STARTED",
  "ORDER_PAUSED",
  "ORDER_RESUMED",
  "COMPLETION_SUBMITTED",
  "ORDER_COMPLETED",
  "ORDER_CANCELLED",
  "CUSTOMER_CONFIRMED",
  "ORDER_CLAIMED",
  "ASSIGNMENT_ACCEPTED",
  "ASSIGNMENT_STARTED",
  "ASSIGNMENT_COMPLETED",
  "ASSIGNMENT_CANCELLED",
  "ASSIGNMENT_RELEASED",
  "ASSIGNMENT_DECLINED",
  "BOOSTER_ABANDONED",
  "ORDER_MOVED_TO_DRAFT",
  "DRAFT_EDITED",
  "ORDER_REPUBLISHED",
  "RIOT_ACCOUNT_UPDATED",
  "ACCOUNT_CREDENTIALS_UPDATED",
  "ACCOUNT_CREDENTIALS_REMOVED",
  "ACCOUNT_CREDENTIALS_VIEWED",
]);

export type RecordOrderEventInput = {
  orderId: string;
  type: OrderEventType | string;
  actorUserId?: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  statusSnapshot?: string;
  db?: DbClient;
};

export async function recordOrderEvent(input: RecordOrderEventInput) {
  if (!input.type || !VALID_EVENT_TYPES.has(input.type as OrderEventType)) {
    // Still allow if it's a valid string that matches our enum set of expected values
    const validSet = new Set<string>(VALID_EVENT_TYPES);
    if (!validSet.has(input.type as string)) {
      throw new Error("Invalid event type");
    }
  }
  const db = input.db ?? prisma;
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
  };
  return db.orderEvent.create({
    data: {
      orderId: input.orderId,
      type: input.type as string,
      message: input.message ?? null,
      metadata: metadata as never,
    },
  });
}

export async function getOrderActivity(orderId: string, page = 1, pageSize = 50) {
  const skip = (page - 1) * pageSize;
  const [events, total] = await Promise.all([
    prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      skip,
      take: pageSize,
    }),
    prisma.orderEvent.count({ where: { orderId } }),
  ]);
  return { events, total, page, pageSize };
}

export async function getOrderTrackingDetails(orderId: string, userId: string, role: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { events: { orderBy: { createdAt: "asc" } }, assignments: true },
  });
  if (!order) return null;
  if (role === "CUSTOMER" && order.userId !== userId) return null;
  if (role === "BOOSTER") {
    const assigned = order.assignments.some((a) => a.boosterId === userId);
    if (!assigned) return null;
  }
  return order;
}
