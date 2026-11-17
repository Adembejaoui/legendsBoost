import { $Enums } from "@/app/generated/prisma/client";

export type OrderStatusValue = $Enums.OrderStatus;

export interface OrderStatusConfig {
  label: string;
  description: string;
  color: "default" | "pending" | "active" | "completed" | "cancelled";
  icon: React.ComponentType<{ className?: string }>;
}

export const ORDER_STATUS_CONFIG: Record<OrderStatusValue, OrderStatusConfig> = {
  [$Enums.OrderStatus.PENDING]: {
    label: "Pending",
    description: "Order is available to be claimed by a booster.",
    color: "pending",
    icon: () => null,
  },
  [$Enums.OrderStatus.CLAIMED]: {
    label: "Booster assigned",
    description: "A booster has taken this order and will start shortly.",
    color: "active",
    icon: () => null,
  },
  [$Enums.OrderStatus.IN_PROGRESS]: {
    label: "In progress",
    description: "A booster is actively working on this order.",
    color: "active",
    icon: () => null,
  },
  [$Enums.OrderStatus.AWAITING_CONFIRMATION]: {
    label: "Awaiting confirmation",
    description: "The booster finished the order. The customer confirms the result, or it confirms automatically after 72 hours.",
    color: "active",
    icon: () => null,
  },
  [$Enums.OrderStatus.PAUSED]: {
    label: "Paused",
    description: "Work on this order is paused and can be resumed.",
    color: "default",
    icon: () => null,
  },
  [$Enums.OrderStatus.COMPLETED]: {
    label: "Completed",
    description: "Order has been successfully completed.",
    color: "completed",
    icon: () => null,
  },
  [$Enums.OrderStatus.CANCELLED]: {
    label: "Cancelled",
    description: "Order has been cancelled.",
    color: "cancelled",
    icon: () => null,
  },
  [$Enums.OrderStatus.DRAFT]: {
    label: "Under review",
    description: "The order is being reviewed by our team before it is offered to a new booster.",
    color: "default",
    icon: () => null,
  },
  [$Enums.OrderStatus.AWAITING_PAYMENT]: {
    label: "Awaiting payment",
    description: "Payment has not been confirmed yet. The order is not offered to boosters until it is.",
    color: "pending",
    icon: () => null,
  },
} as const;

export const STATUS_TABS: Array<{
  key: "all" | "active" | "completed" | "cancelled";
  label: string;
  statuses: OrderStatusValue[];
}> = [
  { key: "all", label: "All orders", statuses: [] },
  { key: "active", label: "Active", statuses: [$Enums.OrderStatus.PENDING, $Enums.OrderStatus.IN_PROGRESS, $Enums.OrderStatus.PAUSED] },
  { key: "completed", label: "Completed", statuses: [$Enums.OrderStatus.COMPLETED] },
  { key: "cancelled", label: "Cancelled", statuses: [$Enums.OrderStatus.CANCELLED] },
];

export function getStatusConfig(status: OrderStatusValue): OrderStatusConfig {
  return ORDER_STATUS_CONFIG[status] ?? ORDER_STATUS_CONFIG[$Enums.OrderStatus.PENDING];
}

export function formatStatusLabel(status: OrderStatusValue): string {
  return ORDER_STATUS_CONFIG[status]?.label ?? status;
}
