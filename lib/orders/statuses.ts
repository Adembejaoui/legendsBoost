import { $Enums } from "@/app/generated/prisma/client";

export const OrderStatus = $Enums.OrderStatus;

export const ACTIVE_ORDER_STATUSES: $Enums.OrderStatus[] = [
  $Enums.OrderStatus.PENDING,
  $Enums.OrderStatus.IN_PROGRESS,
  $Enums.OrderStatus.PAUSED,
];

export const COMPLETED_ORDER_STATUSES: $Enums.OrderStatus[] = [$Enums.OrderStatus.COMPLETED];
export const CANCELLED_ORDER_STATUSES: $Enums.OrderStatus[] = [$Enums.OrderStatus.CANCELLED];
