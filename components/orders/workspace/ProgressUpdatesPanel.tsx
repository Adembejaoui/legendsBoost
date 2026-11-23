"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { ExternalLink, History, TrendingUp } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { GameArt } from "./Panel";

/** Fired by the session panel after "End session": ask for a rank update. */
export const OPEN_RANK_UPDATE_EVENT = "lb:open-rank-update";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Booster: post the account's current rank (tier, division, LP / RR). */
function RankUpdateDialog({ data, open, onClose, prompt }: { data: WorkspaceDTO; open: boolean; onClose: () => void; prompt: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const u = data.updates;
  const last = u.list[0] ?? null;
  // Options only cover the bought range: start from the latest update if it
  // is in it, else from the starting rank (first option).
  const lastOpt = last ? u.rankOptions.find((t) => t.tierId === last.tierId) : undefined;
  const lastValid = !!lastOpt && (lastOpt.divisions.length === 0 || lastOpt.divisions.some((d) => d.id === last!.divisionId));
  const first = u.rankOptions[0];
  const [tierId, setTierId] = useState(lastValid ? last!.tierId : first?.tierId ?? "");
  const [divisionId, setDivisionId] = useState<string | null>(lastValid ? last!.divisionId : first?.divisions[0]?.id ?? null);
  const [lp, setLp] = useState(last?.lp !== null && last?.lp !== undefined ? String(last.lp) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tier = u.rankOptions.find((t) => t.tierId === tierId) ?? null;
  const needsDivision = (tier?.divisions.length ?? 0) > 0;
  const validDivision = !needsDivision || tier!.divisions.some((d) => d.id === divisionId);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId, divisionId: needsDivision ? divisionId : null, lp: lp.trim() === "" ? null : Number(lp) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; update?: { label: string } };
      if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
      toast({ type: "success", title: "Rank updated", description: `The customer now sees ${body.update?.label ?? "the new rank"}.` });
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={prompt ? "Session ended: update the rank" : "Update the current rank"}
      confirmLabel="Post update"
      busyLabel="Posting…"
      cancelLabel={prompt ? "Later" : "Cancel"}
      busy={busy}
      confirmDisabled={!tier || !validDivision || (lp.trim() !== "" && !/^\d{1,4}$/.test(lp.trim()))}
      error={error}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <p>Post the rank shown in the game right now. The customer sees it on the order page and can check it on their profile.</p>
      {first && (
        <p className="text-xs text-zinc-500">
          Only ranks of this order: {first.name}
          {first.divisions[0] ? ` ${first.divisions[0].label}` : ""} to {u.rankOptions[u.rankOptions.length - 1].name}
          {u.rankOptions[u.rankOptions.length - 1].divisions.at(-1) ? ` ${u.rankOptions[u.rankOptions.length - 1].divisions.at(-1)!.label}` : ""}.
        </p>
      )}
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {u.rankOptions.map((t) => (
          <button
            key={t.tierId}
            type="button"
            onClick={() => {
              setTierId(t.tierId);
              setDivisionId(t.divisions.length ? (t.divisions.some((d) => d.id === divisionId) ? divisionId : t.divisions[0].id) : null);
            }}
            aria-pressed={tierId === t.tierId}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] transition-colors",
              tierId === t.tierId
                ? "border-[var(--g-accent)] bg-[rgba(var(--g-rgb),0.12)] text-white"
                : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
            )}
          >
            <GameArt src={t.iconSrc} alt="" fallback={t.name} className="size-8 object-contain" />
            {t.name}
          </button>
        ))}
      </div>
      {needsDivision && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-400">Division</span>
          {tier!.divisions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDivisionId(d.id)}
              aria-pressed={divisionId === d.id}
              className={cn(
                "min-w-9 rounded-md border px-2 py-1 text-xs font-semibold",
                divisionId === d.id ? "border-[var(--g-accent)] bg-[rgba(var(--g-rgb),0.15)] text-white" : "border-white/10 text-zinc-300 hover:bg-white/5"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2">
        <span className="text-xs text-zinc-400">{u.pointsLabel} (optional)</span>
        <input
          inputMode="numeric"
          value={lp}
          onChange={(e) => setLp(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
          placeholder="0"
          className="w-20 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none focus:border-white/30"
        />
      </label>
    </ConfirmDialog>
  );
}

/**
 * Rank updates posted by the booster (decision 2026-11-17: replaces the
 * Riot match history). Booster: "Update rank"; everyone: the timeline.
 */
export function ProgressUpdatesPanel({ data, className }: { data: WorkspaceDTO; className?: string }) {
  const u = data.updates;
  const [dialog, setDialog] = useState<"manual" | "prompt" | null>(null);

  useEffect(() => {
    if (!u.canPost) return;
    const open = () => setDialog("prompt");
    window.addEventListener(OPEN_RANK_UPDATE_EVENT, open);
    return () => window.removeEventListener(OPEN_RANK_UPDATE_EVENT, open);
  }, [u.canPost]);

  if (data.ranks.tracking === "unsupported" && u.list.length === 0) return null;

  return (
    <section aria-label="Rank updates" className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10121a]", className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          <History className="size-3.5 text-[var(--g-accent)]" />
          Rank updates
        </h2>
        <div className="flex items-center gap-2">
          {u.selfCheck && data.viewer.role !== "booster" && (
            <a href={u.selfCheck.url} target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1 text-[11px] text-zinc-400 hover:text-white sm:inline-flex">
              {u.selfCheck.label} <ExternalLink className="size-3" />
            </a>
          )}
          {u.canPost && (
            <button
              type="button"
              onClick={() => setDialog("manual")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--g-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--g-on)] hover:bg-[var(--g-hover)]"
            >
              <TrendingUp className="size-3.5" /> Update rank
            </button>
          )}
        </div>
      </header>

      {u.stale && u.canPost && (
        <p className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          No rank update for 24 hours. Post the current rank so the customer can follow the progress.
        </p>
      )}

      <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {u.list.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-zinc-500">
            {data.viewer.role === "booster"
              ? "No update yet. Post the current rank after each session."
              : "No update yet. Your booster posts the current rank after each play session."}
          </li>
        ) : (
          u.list.map((x, i) => (
            <li key={x.id} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5", i === 0 && "bg-[rgba(var(--g-rgb),0.06)]")}>
              <GameArt src={x.iconSrc} alt="" fallback={x.label} className="size-8 shrink-0 object-contain" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {x.label}
                  {x.lp !== null && <span className="ms-1.5 font-normal tabular-nums text-zinc-400">{x.lp} {u.pointsLabel}</span>}
                </p>
                <p className="text-[11px] text-zinc-500">{when(x.at)}</p>
              </div>
              {i === 0 && <span className="rounded-full bg-[rgba(var(--g-rgb),0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--g-light)]">Latest</span>}
            </li>
          ))
        )}
      </ol>

      {u.canPost && dialog && (
        <RankUpdateDialog data={data} open prompt={dialog === "prompt"} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
