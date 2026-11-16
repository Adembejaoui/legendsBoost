"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Link2, Loader2, Lock, RefreshCw, ShieldAlert, Unlink } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { PanelOrSection, Pill, Row } from "./Panel";

const LINK_LABEL = {
  MANUAL: { label: "Identified (not verified)", tone: "neutral" as const },
  RESOLVED: { label: "Found on Riot in this region (ownership not verified)", tone: "blue" as const },
  RSO_VERIFIED: { label: "Verified via Riot Sign On", tone: "green" as const },
};

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function RiotAccountPanel({ data, embedded = false }: { data: WorkspaceDTO; embedded?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const acc = data.riot.account;
  const caps = data.riot.capabilities;
  const canEdit = data.access.canEditRiotAccount;
  const [editing, setEditing] = useState(!acc && canEdit);
  const [gameName, setGameName] = useState(acc?.gameName ?? "");
  const [tagLine, setTagLine] = useState(acc?.tagLine ?? "");
  const [platform, setPlatform] = useState(acc?.platform ?? "");
  const [busy, setBusy] = useState<"save" | "sync" | "unlink" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function call(kind: "save" | "sync" | "unlink") {
    setBusy(kind);
    setError(null);
    try {
      const res =
        kind === "save"
          ? await fetch(`/api/orders/${data.order.id}/game-account`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gameName, tagLine, platform }),
            })
          : kind === "unlink"
            ? await fetch(`/api/orders/${data.order.id}/game-account`, { method: "DELETE" })
            : await fetch(`/api/orders/${data.order.id}/riot/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Riot says the account plays on another server: pre-select it.
        if (kind === "save" && typeof body.suggestedPlatform === "string") setPlatform(body.suggestedPlatform);
        throw new Error(body.error ?? body.reason ?? "Request failed");
      }
      if (kind === "save") {
        setEditing(false);
        toast(
          body.warning
            ? { title: "Riot ID saved (not verified yet)", description: body.warning }
            : { title: "Riot account found and saved" }
        );
      } else if (kind === "unlink") {
        toast({ type: "info", title: "Riot account unlinked" });
        setGameName("");
        setTagLine("");
        setPlatform("");
        setEditing(true);
      } else {
        const found = body.newMatches ? `${body.newMatches} new order match(es) found.` : "No new order matches.";
        toast({
          type: body.complete === false ? "info" : "success",
          title: body.complete === false ? "Riot data partly refreshed" : "Riot data refreshed",
          description:
            body.complete === false && body.pendingMatches
              ? `${found} ${body.pendingMatches} more match(es) are queued: sync again in a minute.`
              : found,
        });
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PanelOrSection
      embedded={embedded}
      dense
      title="Riot account"
      icon={<Link2 className="size-3.5" />}
      action={
        acc && canEdit && !editing && !acc.locked ? (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-violet-300 hover:text-violet-200">
            Edit
          </button>
        ) : acc?.locked ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500" title={acc.lockMessage ?? "Locked"}>
            <Lock className="size-3" /> Locked
          </span>
        ) : null
      }
    >
      {editing && canEdit ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void call("save");
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Game name</span>
              <input
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
                required
                minLength={3}
                maxLength={16}
                autoComplete="off"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--g-accent)]/60"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Tagline</span>
              <div className="flex items-center rounded-lg border border-white/10 bg-black/30 focus-within:border-[var(--g-accent)]/60">
                <span className="pl-2 text-sm text-zinc-500">#</span>
                <input
                  value={tagLine}
                  onChange={(e) => setTagLine(e.target.value.replace(/^#/, ""))}
                  required
                  minLength={3}
                  maxLength={5}
                  autoComplete="off"
                  className="w-full bg-transparent px-1.5 py-2 text-sm text-white outline-none"
                />
              </div>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Region</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              required
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--g-accent)]/60"
            >
              <option value="" disabled>
                Select region
              </option>
              {data.riot.platforms.map((p) => (
                <option key={p.value} value={p.value} className="bg-[#11131a]">
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="flex gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-zinc-400">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--g-accent)]" />
            Your public Riot ID (name#tag) is used to track rank and matches. Your login goes in the separate
            &ldquo;Account login&rdquo; box, which is encrypted.
          </p>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--g-accent)] px-3.5 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[var(--g-hover)] disabled:opacity-60"
            >
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              Save Riot ID
            </button>
            {acc && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-zinc-300 hover:bg-white/5"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : acc ? (
        <>
          <p className="truncate text-sm font-semibold text-white">
            {acc.gameName}
            <span className="text-zinc-500">#{acc.tagLine}</span>
          </p>
          <dl className="mt-2 divide-y divide-white/[0.04]">
            <Row label="Region" value={acc.platform ?? <span className="text-zinc-500">Not set</span>} />
            <Row
              label="Status"
              value={
                <Pill tone={LINK_LABEL[acc.linkStatus].tone}>
                  {acc.linkStatus === "RSO_VERIFIED" && <BadgeCheck className="size-3" />}
                  {LINK_LABEL[acc.linkStatus].label}
                </Pill>
              }
            />
            <Row label="Last sync" value={timeAgo(acc.lastSyncedAt)} />
          </dl>
          {acc.platformUnsupported && (
            <p role="alert" className="mt-2 text-xs text-amber-300">{acc.platformUnsupported}</p>
          )}
          {acc.lastSyncError && (
            <p role={acc.lastSyncErrorCode === "wrong_region" || acc.lastSyncErrorCode === "not_found" ? "alert" : undefined} className="mt-2 text-xs text-amber-300">
              {acc.lastSyncError}
            </p>
          )}
          {acc.pendingMatches > 0 && (
            <p className="mt-2 text-xs text-zinc-400">
              {acc.pendingMatches} discovered match(es) still to be checked. They are kept and processed on the next sync.
            </p>
          )}
          {acc.locked && acc.lockMessage && <p className="mt-2 text-[11px] text-zinc-500">{acc.lockMessage}</p>}
          {error && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {data.access.canSyncRiot && caps.dataAccess && (
              <button
                type="button"
                onClick={() => void call("sync")}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-60"
              >
                <RefreshCw className={busy === "sync" ? "size-3.5 animate-spin" : "size-3.5"} />
                Sync Riot data
              </button>
            )}
            {canEdit && !acc.locked && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Unlink this Riot account from the order?")) void call("unlink");
                }}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-rose-300 disabled:opacity-60"
              >
                <Unlink className="size-3.5" />
                Unlink
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-500">
          {data.viewer.role === "customer" ? "Add your Riot ID to enable tracking." : "The customer has not added a Riot ID yet."}
        </p>
      )}

      {!caps.dataAccess ? (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-[11px] leading-relaxed text-amber-200/90">
          <p className="font-medium">Official Riot integration pending</p>
          <p className="mt-0.5 text-amber-200/70">
            {caps.reason ?? "Riot data is not available."} Ranks are only shown when they come from Riot.
          </p>
        </div>
      ) : null}
    </PanelOrSection>
  );
}
