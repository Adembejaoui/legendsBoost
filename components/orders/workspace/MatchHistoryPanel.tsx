"use client";

import { useState } from "react";
import { History, Loader2 } from "lucide-react";
import type { WorkspaceDTO, WorkspaceMatchDTO, WorkspaceMatchPage } from "@/lib/orders/workspace-types";
import { cn } from "@/lib/utils";
import { GameArt } from "./Panel";

function duration(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")}`;
}

function MatchRow({ m }: { m: WorkspaceMatchDTO }) {
  const kda = m.deaths === 0 ? "Perfect" : ((m.kills + m.assists) / m.deaths).toFixed(2);
  const minutes = Math.max(1, m.durationSec / 60);
  const played = new Date(m.playedAt);
  return (
    <li
      className={cn(
        "grid h-11 grid-cols-[3px_32px_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-lg border bg-black/20 pr-3",
        m.win ? "border-emerald-500/15" : "border-rose-500/15"
      )}
    >
      <span className={cn("h-full", m.win ? "bg-emerald-400" : "bg-rose-400")} aria-hidden />
      <GameArt src={m.championIcon} alt="" fallback={m.championName} className="size-8 rounded-md" />
      <div className="min-w-0 leading-tight">
        <p className="flex items-center gap-1.5 text-[13px]">
          <span className={cn("font-semibold", m.win ? "text-emerald-300" : "text-rose-300")}>{m.win ? "Win" : "Loss"}</span>
          {m.lpDelta !== null && (
            <span className={cn("text-[11px] font-semibold tabular-nums", m.lpDelta >= 0 ? "text-emerald-300/80" : "text-rose-300/80")}>
              {m.lpDelta >= 0 ? "+" : ""}
              {m.lpDelta} LP
            </span>
          )}
          <span className="truncate text-zinc-200">{m.championName}</span>
          {m.playedBy !== "BOOSTER" && (
            <span
              className="shrink-0 rounded bg-amber-400/15 px-1 text-[10px] text-amber-300"
              title="Not played in a booster session: does not count for the order"
            >
              {m.playedBy === "PAUSED" ? "During pause" : "Not booster"}
            </span>
          )}
        </p>
        <p className="truncate text-[11px] text-zinc-500">
          {m.queue} · {duration(m.durationSec)} ·{" "}
          <time dateTime={m.playedAt} title={played.toLocaleString()}>
            {played.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
          </time>
        </p>
      </div>
      <div className="text-end leading-tight">
        <p className="text-[13px] font-semibold tabular-nums text-white">
          {m.kills}/<span className="text-rose-300">{m.deaths}</span>/{m.assists}
        </p>
        <p className="text-[11px] tabular-nums text-zinc-500">
          {kda} KDA · {m.cs} CS ({(m.cs / minutes).toFixed(1)})
        </p>
      </div>
    </li>
  );
}

/**
 * Order-attributed games, newest first (server order: gameStartAt desc).
 * Fills the fixed-height bottom strip and scrolls internally.
 */
export function MatchHistoryPanel({ data, className }: { data: WorkspaceDTO; className?: string }) {
  const [page, setPage] = useState<WorkspaceMatchPage>(data.matches);
  const [source, setSource] = useState(data.matches);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A server refresh (e.g. after a sync) replaces the first page.
  if (source !== data.matches) {
    setSource(data.matches);
    setPage(data.matches);
  }

  // Only games played in booster sessions count for the order.
  const wins = page.matches.filter((m) => m.win && m.playedBy === "BOOSTER").length;
  const losses = page.matches.filter((m) => !m.win && m.playedBy === "BOOSTER").length;
  const tracked = data.order.gameSlug === "league-of-legends";

  async function loadMore() {
    if (!page.nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/matches?cursor=${encodeURIComponent(page.nextCursor)}&limit=10`);
      if (!res.ok) throw new Error();
      const next = (await res.json()) as WorkspaceMatchPage;
      setPage((prev) => {
        const seen = new Set(prev.matches.map((m) => m.id));
        return {
          matches: [...prev.matches, ...next.matches.filter((m) => !seen.has(m.id))],
          nextCursor: next.nextCursor,
          total: next.total,
        };
      });
    } catch {
      setError("Could not load more matches.");
    } finally {
      setLoading(false);
    }
  }

  let emptyText: string;
  if (!tracked) emptyText = `Automatic match tracking isn't available for ${data.order.gameName}.`;
  else if (!data.riot.capabilities.dataAccess) emptyText = "Match tracking needs the official Riot integration, which is pending approval.";
  else if (!data.riot.account) emptyText = "Add the Riot ID to track games played for this order.";
  else emptyText = "Only games played on the order's account while a booster was actively working on it appear here.";

  return (
    <section
      aria-label="Match history"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#11131a]", className)}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          <History className="size-3.5 text-[var(--g-accent)]" />
          Match history
        </h2>
        {page.total > 0 && (
          <span className="text-[11px] tabular-nums text-zinc-500">
            {page.total} game{page.total === 1 ? "" : "s"}
            {page.matches.length === page.total ? (
              <>
                {" · "}
                <span className="text-emerald-300">{wins}W</span> <span className="text-rose-300">{losses}L</span>
              </>
            ) : (
              ` · showing ${page.matches.length}`
            )}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {page.matches.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center">
            <div>
              <p className="text-sm text-zinc-400">No games attributed to this order yet.</p>
              <p className="mx-auto mt-0.5 max-w-md text-xs text-zinc-500">{emptyText}</p>
            </div>
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-1.5 2xl:grid-cols-2">
              {page.matches.map((m) => (
                <MatchRow key={m.id} m={m} />
              ))}
            </ul>
            {page.nextCursor && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className="mt-1.5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-1.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-60"
              >
                {loading && <Loader2 className="size-3.5 animate-spin" />}
                Load older games
              </button>
            )}
            {error && (
              <p role="alert" className="mt-1.5 text-center text-xs text-rose-400">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
