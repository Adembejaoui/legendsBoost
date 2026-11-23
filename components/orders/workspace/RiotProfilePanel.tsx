"use client";

import { Radio, UserRound } from "lucide-react";
import type { WorkspaceDTO, WorkspaceRiotProfileDTO } from "@/lib/orders/workspace-types";
import { cn } from "@/lib/utils";
import { Panel, Pill } from "./Panel";

function ago(iso: string | null) {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

type Ranked = NonNullable<WorkspaceRiotProfileDTO["ranked"]>[number];

function rankText(r: Ranked) {
  if (!r.tier) return "Unranked";
  const tier = r.tier.charAt(0) + r.tier.slice(1).toLowerCase();
  // Apex tiers (Master+) have no division.
  const apex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(r.tier);
  return apex || !r.division ? tier : `${tier} ${r.division}`;
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{children}</p>;
}

/** Riot profile: current rank (division + LP), last 2 games, top 3 champions. */
export function RiotProfilePanel({ data }: { data: WorkspaceDTO }) {
  const p = data.riot.profile;
  if (!p) return null;
  const platform = data.riot.account?.platform ?? null;
  const regionMismatch = p.activeRegion && platform && p.activeRegion !== platform;
  const solo = p.ranked?.find((r) => r.queue === "RANKED_SOLO_5x5") ?? null;
  const flex = p.ranked?.find((r) => r.queue === "RANKED_FLEX_SR") ?? null;
  const main = solo ?? flex;
  const other = main === solo ? flex : null;

  return (
    <Panel
      dense
      title="Riot profile"
      icon={<UserRound className="size-3.5" />}
      action={
        p.syncedAt ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500" title="Refreshed automatically when a new game is played">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Updated {ago(p.syncedAt)}
          </span>
        ) : null
      }
    >
      {/* Identity */}
      <div className="flex items-center gap-3">
        {p.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.iconUrl} alt="" className="size-11 rounded-lg border border-white/10" />
        ) : (
          <div className="size-11 rounded-lg border border-white/10 bg-white/5" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Level {p.level ?? "?"}</p>
          <p className="text-xs text-zinc-400">
            Plays on {p.activeRegion ?? "unknown"}
            {regionMismatch && <span className="text-amber-300"> (order server is {platform})</span>}
          </p>
          {p.liveGame?.inGame && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-300">
              <Radio className="size-3 animate-pulse" /> In game{p.liveGame.championName ? ` as ${p.liveGame.championName}` : ""}
              {p.liveGame.queue ? ` · ${p.liveGame.queue}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Current rank */}
      <div className="mt-3">
        <Label>Current rank</Label>
        {p.ranked === null ? (
          <p className="text-xs text-zinc-500">Not loaded yet.</p>
        ) : !main ? (
          <p className="text-sm text-zinc-300">Unranked this season</p>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-[var(--g-accent)]/20 bg-[var(--g-accent)]/[0.05] p-2.5">
            {main.iconSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={main.iconSrc} alt="" className="size-12 object-contain" />
            ) : (
              <div className="size-12" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-zinc-400">{main.label}</p>
              <p className="text-lg font-bold leading-tight text-white">{rankText(main)}</p>
              <p className="text-sm font-semibold text-[var(--g-accent)]">{main.lp} LP</p>
            </div>
            <div className="text-end text-[11px] text-zinc-400">
              <p>{main.wins}W {main.losses}L</p>
              {main.winRate !== null && <Pill tone={main.winRate >= 50 ? "green" : "red"}>{main.winRate}%</Pill>}
            </div>
          </div>
        )}
        {other && (
          <p className="mt-1.5 text-xs text-zinc-400">
            {other.label}: <span className="text-zinc-200">{rankText(other)} · {other.lp} LP</span> ({other.wins}W {other.losses}L)
          </p>
        )}
      </div>

      {/* Last 2 games */}
      <div className="mt-3">
        <Label>Last games</Label>
        {p.recentMatches === null ? (
          <p className="text-xs text-zinc-500">Not loaded yet.</p>
        ) : p.recentMatches.length === 0 ? (
          <p className="text-xs text-zinc-400">No recent games.</p>
        ) : (
          <div className="space-y-1.5">
            {p.recentMatches.map((m) => (
              <div
                key={m.matchId}
                className={cn(
                  "flex items-center gap-2 rounded-lg border-l-2 p-2",
                  m.remake ? "border-zinc-500 bg-white/[0.03]" : m.win ? "border-emerald-400 bg-emerald-500/[0.07]" : "border-rose-400 bg-rose-500/[0.07]"
                )}
              >
                {m.championIcon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.championIcon} alt="" className="size-9 rounded" />
                ) : (
                  <div className="size-9 rounded bg-white/5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {m.championName}{" "}
                    <span className={cn("text-xs font-semibold", m.remake ? "text-zinc-400" : m.win ? "text-emerald-300" : "text-rose-300")}>
                      {m.remake ? "Remake" : m.win ? "Victory" : "Defeat"}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {m.queue} · {Math.round(m.durationSec / 60)} min{m.endedAt ? ` · ${ago(m.endedAt)}` : ""}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-semibold text-white">
                    {m.kills}/<span className="text-rose-300">{m.deaths}</span>/{m.assists}
                  </p>
                  <p className="text-[11px] text-zinc-500">{m.cs} CS</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top 3 champions */}
      {p.mastery && p.mastery.length > 0 && (
        <div className="mt-3">
          <Label>Top champions</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {p.mastery.slice(0, 3).map((m) => (
              <div
                key={m.championId}
                className="flex flex-col items-center gap-1 rounded-lg bg-black/20 p-2 text-center"
                title={`${m.name}: mastery ${m.level}, ${m.points.toLocaleString()} points`}
              >
                {m.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.icon} alt="" className="size-9 rounded" />
                ) : (
                  <div className="size-9 rounded bg-white/5" />
                )}
                <span className="w-full truncate text-xs text-zinc-200">{m.name}</span>
                <span className="text-[10px] text-zinc-500">
                  M{m.level} · {m.points >= 1000 ? `${Math.round(m.points / 1000)}k` : m.points}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
