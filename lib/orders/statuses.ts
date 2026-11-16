import { $Enums } from "@/app/generated/prisma/client";

export const OrderStatus = $Enums.OrderStatus;

/** Customer-visible active orders (checkout holds are not orders). */
export const ACTIVE_ORDER_STATUSES: $Enums.OrderStatus[] = [
  $Enums.OrderStatus.PENDING,
  $Enums.OrderStatus.IN_PROGRESS,
  $Enums.OrderStatus.PAUSED,
];

export const COMPLETED_ORDER_STATUSES: $Enums.OrderStatus[] = [$Enums.OrderStatus.COMPLETED];
export const CANCELLED_ORDER_STATUSES: $Enums.OrderStatus[] = [$Enums.OrderStatus.CANCELLED];
export const DRAFT_ORDER_STATUSES: $Enums.OrderStatus[] = [$Enums.OrderStatus.DRAFT];
