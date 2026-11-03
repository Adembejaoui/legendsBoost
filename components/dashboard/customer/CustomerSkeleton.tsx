import { $Enums } from "@/app/generated/prisma/client";
import { User as UserIcon, Clock, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { ORDER_STATUS_CONFIG } from "@/lib/orders/status-display";

interface CustomerSkeletonProps {
  activeOrders: number;
  completedOrders: number;
  totalOrders: number;
}

export function CustomerSkeleton({ activeOrders, completedOrders, totalOrders }: CustomerSkeletonProps) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="h-4 w-3/4 bg-white/5 rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-white/5 rounded animate-pulse" />
        <div className="h-32 bg-white/5 rounded-xl animate-pulse" />
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[totalOrders, activeOrders, completedOrders].map((value, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-5 animate-pulse">
            <div className="h-4 w-16 bg-white/10 rounded mb-3" />
            <div className="h-8 w-24 bg-white/10 rounded" />
          </div>
        ))}
      </section>

      <section className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center animate-pulse">
            <div className="h-12 w-12 rounded-lg bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-white/10 rounded" />
              <div className="h-3 w-1/2 bg-white/10 rounded" />
            </div>
            <div className="h-8 w-24 bg-white/10 rounded" />
            <div className="h-8 rounded-full bg-white/10" />
          </div>
        ))}
      </section>
    </div>
  );
}
