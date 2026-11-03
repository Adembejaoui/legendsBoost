import Link from "next/link";
import { $Enums } from "@/app/generated/prisma/client";
import { formatStatusLabel, ORDER_STATUS_CONFIG } from "@/lib/orders/status-display";

interface StatusBadgeProps {
  status: $Enums.OrderStatus;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const cfg = ORDER_STATUS_CONFIG[status];
  const classes = {
    sm: "px-2.5 py-0.5 text-[0.7rem]",
    md: "px-3 py-1 text-sm",
  }[size];

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        cfg.color === "completed"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : cfg.color === "active"
            ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
            : cfg.color === "cancelled"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
              : "border-white/20 bg-white/5 text-zinc-400"
      } ${classes}`}
    >
      {cfg.label}
    </span>
  );
}
