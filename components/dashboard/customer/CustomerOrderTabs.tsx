"use client";

import Link from "next/link";
import { $Enums } from "@/app/generated/prisma/client";
import { ORDER_STATUS_CONFIG, STATUS_TABS } from "@/lib/orders/status-display";

type TabKey = "all" | "active" | "completed" | "cancelled";

interface CustomerOrderTabsProps {
  current: TabKey;
  onChange: (key: TabKey) => void;
  counts: { all: number; active: number; completed: number; cancelled: number };
}

export function CustomerOrderTabs({ current, onChange, counts }: CustomerOrderTabsProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {STATUS_TABS.map((tab) => {
        const isActive = current === tab.key;
        const count = tab.key === "all" ? counts.all : tab.key === "active" ? counts.active : tab.key === "completed" ? counts.completed : counts.cancelled;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-violet-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.25)]"
                : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {tab.label}
            {count > 0 && (
              <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
