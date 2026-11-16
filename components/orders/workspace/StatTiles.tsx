"use client";

import { Gamepad2, Percent, Trophy, TrendingUp } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { cn } from "@/lib/utils";

function Tile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "good" | "bad";
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/[0.07] bg-[#10121a] px-3 py-2.5">
      <div aria-hidden className="pointer-events-none absolute -right-4 -top-6 size-16 rounded-full bg-[radial-gradient(circle,rgba(var(--g-rgb),0.14),transparent_70%)]" />
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        <span className="text-[var(--g-accent)]">{icon}</span>
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-xl font-bold tabular-nums leading-none",
          tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-white"
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 truncate text-[10px] text-zinc-500">{sub}</p> : null}
    </div>
  );
}

/**
 * Four quick numbers under the rank hero. Only games played in booster
 * sessions count, as everywhere else in the workspace.
 */
export function StatTiles({ data, className }: { data: WorkspaceDTO; className?: string }) {
  const page = data.matches;
  const counted = page.matches.filter((m) => m.playedBy === "BOOSTER");
  const wins = counted.filter((m) => m.win).length;
  const losses = counted.length - wins;
  const partial = page.total > page.matches.length;
  const scope = partial ? `last ${page.matches.length} games` : undefined;
  const tracked = data.ranks.tracking === "riot";
  const winRate = counted.length ? Math.round((wins / counted.length) * 100) : null;
  const lp = data.progress.lpDelta;
  const winsOrder = data.progress.kind === "wins" && data.progress.wins;

  return (
    <div className={cn("grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      <Tile icon={<Gamepad2 className="size-3" />} label="Games" value={tracked ? page.total : "—"} sub={tracked ? "played for this order" : "not tracked for this game"} />
      <Tile
        icon={<Trophy className="size-3" />}
        label="Record"
        value={
          tracked ? (
            <>
              <span className="text-emerald-300">{wins}W</span> <span className="text-zinc-600">/</span> <span className="text-rose-300">{losses}L</span>
            </>
          ) : (
            "—"
          )
        }
        sub={scope}
      />
      <Tile
        icon={<Percent className="size-3" />}
        label="Win rate"
        value={winRate === null ? "—" : `${winRate}%`}
        tone={winRate === null ? "default" : winRate >= 50 ? "good" : "bad"}
        sub={scope}
      />
      {winsOrder ? (
        <Tile icon={<TrendingUp className="size-3" />} label="Wins done" value={`${winsOrder.attributed}/${winsOrder.ordered ?? "?"}`} sub="ordered wins" />
      ) : (
        <Tile
          icon={<TrendingUp className="size-3" />}
          label="LP gained"
          value={lp === null ? "—" : `${lp > 0 ? "+" : ""}${lp}`}
          tone={lp === null || lp === 0 ? "default" : lp > 0 ? "good" : "bad"}
          sub={lp === null ? "after the first ranked games" : "since the start"}
        />
      )}
    </div>
  );
}
