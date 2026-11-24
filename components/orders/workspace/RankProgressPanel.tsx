"use client";

import { ArrowDown, ArrowUp, ChevronsRight, ExternalLink, TrendingUp } from "lucide-react";
import type { WorkspaceDTO, WorkspaceRankDTO } from "@/lib/orders/workspace-types";
import { cn } from "@/lib/utils";
import { GameArt, Pill } from "./Panel";
import { GAME_COUNT_TEXT } from "@/lib/orders/game-count";

const SOURCE_LABEL: Record<WorkspaceRankDTO["source"], { text: string; tone: "green" | "neutral" }> = {
  riot: { text: "Riot data", tone: "green" },
  order: { text: "From order", tone: "neutral" },
  booster: { text: "Booster update", tone: "green" },
};

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function tierName(rank: WorkspaceRankDTO) {
  const t = rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase();
  return rank.division ? `${t} ${rank.division}` : t;
}

/** Emblem size follows the viewport HEIGHT so the page never needs to scroll. */
const EMBLEM =
  "size-14 [@media(min-height:780px)]:size-[4.5rem] [@media(min-height:900px)]:size-24 [@media(min-height:1040px)]:size-28";

function RankBlock({
  heading,
  rank,
  emptyTitle,
  emptyText,
  accent,
  showLp = true,
  points = "LP",
}: {
  points?: string;
  heading: string;
  rank: WorkspaceRankDTO | null;
  emptyTitle: string;
  emptyText: string;
  accent: "current" | "target";
  showLp?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.18em]",
          accent === "target" ? "text-[var(--g-light)]" : "text-zinc-400"
        )}
      >
        {heading}
      </p>
      <div className="relative my-1.5 grid place-items-center">
        <div
          aria-hidden
          className={cn(
            "absolute inset-[-30%] rounded-full blur-md",
            accent === "target"
              ? "bg-[radial-gradient(circle,rgba(var(--g-rgb),0.35),transparent_65%)]"
              : "bg-[radial-gradient(circle,rgba(var(--g-rgb2),0.22),transparent_65%)]"
          )}
        />
        {rank ? (
          <GameArt
            src={rank.iconSrc}
            alt={`${tierName(rank)} emblem`}
            fallback={rank.tier}
            className={cn("relative object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]", EMBLEM)}
          />
        ) : (
          <span className={cn("relative grid place-items-center rounded-full border border-dashed border-white/15 text-lg text-zinc-600", EMBLEM)}>
            ?
          </span>
        )}
      </div>
      {rank ? (
        <>
          <p className="max-w-full truncate text-sm font-bold leading-tight text-white sm:text-base">{tierName(rank)}</p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
            {showLp && !rank.lpAssumed && <span className="text-xs tabular-nums text-zinc-300">{rank.lp} {points}</span>}
            <Pill tone={SOURCE_LABEL[rank.source].tone} className="hidden px-1.5 py-0 text-[10px] sm:inline-flex">
              {SOURCE_LABEL[rank.source].text}
              {rank.at && rank.source !== "order" ? ` · ${ago(rank.at)}` : ""}
            </Pill>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-300">{emptyTitle}</p>
          <p className="mt-0.5 max-w-[22ch] text-[11px] leading-snug text-zinc-500">{emptyText}</p>
        </>
      )}
    </div>
  );
}

/** Right side for orders counted in games: the number ordered ("5 net wins"). */
function CountBlock({ heading, total, unit }: { heading: string; total: number; unit: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--g-light)]">{heading}</p>
      <div className="relative my-1.5 grid place-items-center">
        <div aria-hidden className="absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,rgba(var(--g-rgb),0.35),transparent_65%)] blur-md" />
        <span className={cn("relative grid place-items-center rounded-full border border-[var(--g-accent)]/40 text-3xl font-black tabular-nums text-white", EMBLEM)}>
          {total}
        </span>
      </div>
      <p className="max-w-full truncate text-sm font-bold leading-tight text-white sm:text-base">
        {total} {total === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit}
      </p>
    </div>
  );
}

/** The hero of the workspace: current rank -> progress -> target rank. */
export function RankProgressPanel({ data, className }: { data: WorkspaceDTO; className?: string }) {
  const { ranks, progress, order, updates } = data;
  const games = progress.kind === "games" && progress.games ? progress.games : null;
  const pct = progress.percent;
  const unsupported = ranks.tracking === "unsupported";

  // Current rank: the booster's latest update (Riot tracking is off).
  let currentEmptyTitle = "No update yet";
  let currentEmptyText =
    data.viewer.role === "booster" ? "Post the current rank with “Update rank”." : "Your booster posts the current rank after each session.";
  if (unsupported) {
    currentEmptyTitle = "Not tracked";
    currentEmptyText = `${order.gameName} has no ranks for this service. Your booster keeps you updated in chat.`;
  }

  let caption: string;
  if (games) {
    caption =
      progress.status === "waiting"
        ? `Waiting for the first update (after each game)`
        : progress.status === "complete"
          ? `All ${games.total} ${games.unit} done`
          : `${games.done} of ${games.total} ${games.unit} done`;
  } else if (unsupported) {
    caption = ranks.start ? "Ordered progression" : "Target rank";
  } else {
    switch (progress.status) {
      case "complete":
        caption = "Target reached (reported by the booster)";
        break;
      case "in_progress":
        caption = progress.stepsDelta && progress.stepsDelta > 0 ? `+${progress.stepsDelta} division${progress.stepsDelta === 1 ? "" : "s"} since the start` : "In progress";
        break;
      case "invalid":
        caption = "Target is not above the starting rank";
        break;
      case "waiting":
        caption = "Waiting for the first rank update";
        break;
      default:
        caption = ranks.current ? "Latest rank from your booster" : "Progress appears with the first rank update";
    }
  }
  const showBar = !!games || (progress.kind !== "none" && !unsupported);
  const value = games
    ? `${games.done}/${games.total}`
    : progress.kind === "wins" && progress.wins
      ? `${progress.wins.attributed}/${progress.wins.ordered ?? "?"}`
      : pct !== null
        ? `${pct}%`
        : null;
  const done = progress.status === "complete";

  return (
    <section
      aria-label="Rank progression"
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10121a]",
        className
      )}
    >
      {/* Game-coloured glows. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(var(--g-rgb),0.20),transparent_55%),radial-gradient(ellipse_at_10%_100%,rgba(var(--g-rgb2),0.10),transparent_55%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--g-accent)]/60 to-transparent" />

      <header className="relative flex shrink-0 items-center justify-between gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          <TrendingUp className="size-3.5 text-[var(--g-accent)]" />
          {games ? GAME_COUNT_TEXT[games.kind].progress : "Rank progression"}
        </h2>
        {updates.selfCheck ? (
          <a
            href={updates.selfCheck.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 truncate text-[11px] font-medium text-[var(--g-light)] hover:underline"
          >
            {updates.selfCheck.label}
            <ExternalLink className="size-3" />
          </a>
        ) : ranks.start && progress.kind === "rank" && !unsupported ? (
          <span className="truncate text-[11px] text-zinc-500">Started at {ranks.start.label}</span>
        ) : null}
      </header>

      <div className="relative grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-2 px-3 pb-4 pt-2 sm:gap-4 sm:px-5">
        <RankBlock
          heading={unsupported || games ? "Starting rank" : "Current rank"}
          points={updates.pointsLabel}
          rank={unsupported || games ? ranks.start : ranks.current}
          emptyTitle={games ? "Not given" : currentEmptyTitle}
          emptyText={games ? "The customer did not choose a rank." : currentEmptyText}
          accent="current"
          showLp={!games}
        />

        <div className="flex min-w-0 flex-col items-center gap-1.5">
          {showBar && value ? (
            <p className={cn("text-3xl font-black tabular-nums leading-none sm:text-4xl", done ? "text-emerald-300" : "text-white")}>{value}</p>
          ) : (
            <ChevronsRight aria-hidden className="size-7 text-[var(--g-accent)]" />
          )}
          {showBar && (
            <div
              className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/[0.04]"
              role="progressbar"
              aria-label="Order progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
              aria-valuetext={pct !== null ? `${pct}%` : caption}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700",
                  done
                    ? "bg-emerald-400"
                    : "bg-[linear-gradient(90deg,rgba(var(--g-rgb),0.55),var(--g-accent),var(--g-light))] shadow-[0_0_12px_rgba(var(--g-rgb),0.6)]",
                  pct === null && "w-0"
                )}
                style={pct !== null ? { width: `${Math.max(pct, 2)}%` } : undefined}
              />
            </div>
          )}
          <p className="text-center text-[11px] leading-snug text-zinc-400 sm:text-xs">{caption}</p>
          <div className="flex flex-wrap justify-center gap-1">
            {progress.lpDelta !== null && progress.lpDelta !== 0 && (
              <Pill tone={progress.lpDelta > 0 ? "green" : "red"} className="px-1.5 py-0 text-[10px]">
                {progress.lpDelta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                {progress.lpDelta > 0 ? "+" : ""}
                {progress.lpDelta} LP
              </Pill>
            )}
            {progress.demoted && <Pill tone="red" className="px-1.5 py-0 text-[10px]">Below start</Pill>}
            {progress.stale && <Pill tone="amber" className="px-1.5 py-0 text-[10px]">No update for 24h</Pill>}
          </div>
        </div>

        {games ? (
          <CountBlock heading={GAME_COUNT_TEXT[games.kind].ordered} total={games.total} unit={games.unit} />
        ) : (
          <RankBlock
            heading="Target rank"
            rank={ranks.target}
            emptyTitle="No target rank"
            emptyText="This service has no rank target."
            accent="target"
            showLp={false}
          />
        )}
      </div>
    </section>
  );
}
