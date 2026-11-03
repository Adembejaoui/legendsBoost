"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getGame, getGameServiceOffer } from "@/lib/catalog/catalog-utils";
import { asRecord, RankRoute, readRank } from "@/components/dashboard/rank-route";

interface Assignment {
  id: string;
  status: string;
  assignedAt: string | Date;
  endedAt?: string | Date | null;
  order: {
    id: string;
    gameSlug: string;
    serviceSlug: string;
    configuration?: unknown;
  };
}

const TABS = [
  { id: "all", label: "All", status: null },
  { id: "in-progress", label: "In progress", status: "IN_PROGRESS" },
  { id: "paused", label: "Paused", status: "PAUSED" },
  { id: "completed", label: "Completed", status: "COMPLETED" },
  { id: "cancelled", label: "Cancelled", status: "CANCELLED" },
] as const;

const STATUS_STYLES: Record<string, { label: string; text: string; bg: string; dot: string }> = {
  IN_PROGRESS: { label: "In progress", text: "text-[#C8AA6E]", bg: "bg-[#C8AA6E]/10", dot: "bg-[#C8AA6E]" },
  PAUSED: { label: "Paused", text: "text-amber-300", bg: "bg-amber-300/10", dot: "bg-amber-300" },
  COMPLETED: { label: "Completed", text: "text-emerald-400", bg: "bg-emerald-400/10", dot: "bg-emerald-400" },
  CANCELLED: { label: "Cancelled", text: "text-rose-400", bg: "bg-rose-400/10", dot: "bg-rose-400" },
  DECLINED: { label: "Declined", text: "text-zinc-400", bg: "bg-zinc-400/10", dot: "bg-zinc-500" },
  RELEASED: { label: "Released", text: "text-zinc-400", bg: "bg-zinc-400/10", dot: "bg-zinc-500" },
};

function humanize(status: string): string {
  const s = status.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Fixed locale and timezone so server and client render the same text.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string | Date): string {
  return dateFormat.format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    label: humanize(status),
    text: "text-zinc-400",
    bg: "bg-zinc-400/10",
    dot: "bg-zinc-500",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        s.text,
        s.bg,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

function AssignmentCard({ assignment }: { assignment: Assignment }) {
  const { order } = assignment;
  const game = getGame(order.gameSlug);
  const gameName = game?.name ?? order.gameSlug;
  const serviceTitle =
    getGameServiceOffer(order.gameSlug, order.serviceSlug)?.title ?? order.serviceSlug;

  const config = asRecord(order.configuration);
  const currentRank = readRank(order.gameSlug, order.serviceSlug, "currentRank", config);
  const targetRank = readRank(order.gameSlug, order.serviceSlug, "targetRank", config);
  const isWinBoost = order.serviceSlug === "win-boost";
  const isActive = assignment.status === "IN_PROGRESS";

  return (
    <article
      className={cn(
        "rounded-xl border border-white/10 bg-[#0b0f19] p-5",
        isActive && "border-l-2 border-l-[#C8AA6E]",
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {game?.image ? (
            <Image
              src={game.image}
              alt=""
              width={36}
              height={36}
              className="size-9 rounded-full border border-white/10 bg-white/5 object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white"
            >
              {gameName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">{serviceTitle}</h3>
            <p className="truncate text-xs text-zinc-400">{gameName}</p>
          </div>
        </div>
        <StatusBadge status={assignment.status} />
      </header>

      <RankRoute
        className="mt-5"
        from={currentRank}
        to={targetRank}
        wins={config["wins"]}
        isWinBoost={isWinBoost}
      />

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 text-xs text-zinc-500">
          <div>Assigned {formatDate(assignment.assignedAt)}</div>
          {assignment.endedAt && <div>Ended {formatDate(assignment.endedAt)}</div>}
          <div className="font-mono">#{order.id.slice(-8).toUpperCase()}</div>
        </div>
        <Link
          href={`/dashboard/booster/orders/${order.id}`}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/40",
            isActive
              ? "bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]"
              : "border border-white/10 text-zinc-200 hover:bg-white/[0.06]",
          )}
        >
          View order
        </Link>
      </footer>
    </article>
  );
}

export default function ClaimedOrdersClient({
  initialAssignments,
}: {
  initialAssignments: Assignment[];
}) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("all");

  const counts = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const a of initialAssignments) {
      byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
    }
    return byStatus;
  }, [initialAssignments]);

  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  const visible = tab.status
    ? initialAssignments.filter((a) => a.status === tab.status)
    : initialAssignments;

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {TABS.map((t) => {
          const count = t.status ? (counts.get(t.status) ?? 0) : initialAssignments.length;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/40",
                active
                  ? "border-[#C8AA6E]/50 bg-[#C8AA6E]/15 text-[#C8AA6E]"
                  : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
              )}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-6 py-14 text-center">
          <p className="text-sm font-medium text-white">
            {tab.status ? `No ${tab.label.toLowerCase()} orders` : "You haven't claimed any orders yet"}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {tab.status
              ? "Orders move here when their status changes."
              : "Claim an order from the available orders list and it will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((assignment) => (
            <AssignmentCard key={assignment.id} assignment={assignment} />
          ))}
        </div>
      )}
    </div>
  );
}