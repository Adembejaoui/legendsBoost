"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { OPEN_RANK_UPDATE_EVENT } from "./ProgressUpdatesPanel";
import { PanelOrSection, Pill } from "./Panel";

/** Revealed credentials are wiped from memory after this long. */
const REVEAL_TTL_MS = 60_000;

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--g-accent)]/60";

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : null;
}

/**
 * Game-account login for the booster.
 *  - Customer: write-only form (the password is never sent back to the browser).
 *  - Booster (in progress): explicit, audited reveal; hidden again after 60 s.
 *  - Admin: status + remove.
 */
export function AccountAccessPanel({ data, embedded = false }: { data: WorkspaceDTO; embedded?: boolean }) {
  const c = data.credentials;
  const router = useRouter();
  const { toast } = useToast();
  const isCustomer = data.viewer.role === "customer";
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | "reveal" | "session" | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const s = data.sessions;
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ username: string; password: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Booster who cannot reveal or run sessions, and nothing saved: nothing useful to show.
  if (data.viewer.role === "booster" && !c.canReveal && !c.saved && !s.canManage) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/account-credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setUsername("");
      setPassword("");
      setEditing(false);
      toast({ type: "success", title: "Account details saved securely" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the saved account login from this order?")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/account-credentials`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not remove");
      toast({ type: "info", title: "Account details removed" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(null);
    }
  }

  async function reveal() {
    setBusy("reveal");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/account-credentials/reveal`, { method: "POST", cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load");
      setRevealed({ username: body.username, password: body.password });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRevealed(null), REVEAL_TTL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load");
    } finally {
      setBusy(null);
    }
  }

  async function session(action: "start" | "end") {
    setBusy("session");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/session`, {
        method: action === "start" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: action === "start" ? JSON.stringify({ rulesAccepted: true }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      if (action === "end") {
        setRevealed(null);
        // Ask for the current rank after every session (decision 2026-11-17).
        window.dispatchEvent(new Event(OPEN_RANK_UPDATE_EVENT));
      }
      setRulesOpen(false);
      setRulesAccepted(false);
      toast({ type: "success", title: action === "start" ? "Session started" : "Session ended" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const sessionBlock = s.canManage ? (
    <div className="mb-3 space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
      {s.open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-emerald-300">Session running since {when(s.open.startedAt)}</span>
          <button type="button" onClick={() => void session("end")} disabled={busy !== null} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-60">
            End session
          </button>
        </div>
      ) : rulesOpen ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-white">Session rules</p>
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-zinc-400">
            {s.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={rulesAccepted} onChange={(e) => setRulesAccepted(e.target.checked)} className="accent-[var(--g-accent)]" />
            I accept these rules
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void session("start")} disabled={!rulesAccepted || busy !== null} className="rounded-lg bg-[var(--g-accent)] px-3 py-1.5 text-xs font-semibold text-[#0A0E14] disabled:opacity-50">
              {busy === "session" ? "Starting…" : "Start session"}
            </button>
            <button type="button" onClick={() => setRulesOpen(false)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">Start a session before you log in to the account.</span>
          <button type="button" onClick={() => setRulesOpen(true)} disabled={busy !== null} className="rounded-lg bg-[var(--g-accent)] px-3 py-1.5 text-xs font-semibold text-[#0A0E14]">
            Start session
          </button>
        </div>
      )}
    </div>
  ) : null;

  const customerSessionNotice =
    isCustomer && s.open ? (
      <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs text-amber-200">
        Your booster is playing now (since {when(s.open.startedAt)}). Please do not log in to your account until the session ends.
      </p>
    ) : null;

  if (c.duo) {
    return (
      <PanelOrSection embedded={embedded} dense title="Account login" icon={<KeyRound className="size-3.5" />}>
        {sessionBlock}
        {customerSessionNotice}
        <p className="text-sm text-zinc-400">Duo order: you play together, so no account login is shared.</p>
      </PanelOrSection>
    );
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ type: "info", title: `${label} copied` });
    } catch {
      /* clipboard unavailable */
    }
  }

  const showForm = c.canEdit && (editing || !c.saved);

  return (
    <PanelOrSection
      embedded={embedded}
      dense
      title="Account login"
      icon={<KeyRound className="size-3.5" />}
      action={c.saved ? <Pill tone="green"><ShieldCheck className="size-3" /> Saved</Pill> : <Pill tone="amber">Missing</Pill>}
    >
      {sessionBlock}
      {customerSessionNotice}
      {!c.configured && (
        <p role="alert" className="mb-2 text-xs text-rose-300">Secure storage is not configured on the server yet.</p>
      )}

      {showForm ? (
        <form onSubmit={save} className="space-y-2.5" autoComplete="off">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Login username (not your Riot ID)</span>
            <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={100} autoComplete="off" spellCheck={false} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Password</span>
            <div className="relative">
              <input
                className={`${input} pr-9`}
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={200}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300" aria-label={showPw ? "Hide password" : "Show password"}>
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <p className="flex gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-zinc-400">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--g-accent)]" />
            Encrypted before it is stored. Only your booster can open it while working on this order, every view is logged
            below, and it is deleted automatically when the order is completed or cancelled. Turn off 2-step verification
            for the boost and change your password afterwards.
          </p>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy !== null || !c.configured} className="inline-flex items-center gap-2 rounded-lg bg-[var(--g-accent)] px-3.5 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[var(--g-hover)] disabled:opacity-60">
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              Save securely
            </button>
            {c.saved && (
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-zinc-300 hover:bg-white/5">
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : c.saved ? (
        <div className="space-y-2">
          {revealed ? (
            <div className="space-y-1.5 rounded-lg border border-[var(--g-accent)]/30 bg-[var(--g-accent)]/[0.05] p-2.5">
              {(["username", "password"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-16 text-[11px] text-zinc-500">{k === "username" ? "Username" : "Password"}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-sm text-white">{revealed[k]}</code>
                  <button type="button" onClick={() => void copy(revealed[k], k === "username" ? "Username" : "Password")} className="text-zinc-400 hover:text-white" aria-label={`Copy ${k}`}>
                    <Copy className="size-3.5" />
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-zinc-500">Hidden again in 60 seconds. Never share or store it elsewhere.</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-300">
              Username <span className="font-mono text-white">{c.usernameHint}</span> · password hidden
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            Updated {when(c.updatedAt)}
            {c.revealCount > 0
              ? ` · viewed by the booster ${c.revealCount} time${c.revealCount > 1 ? "s" : ""}, last ${when(c.lastRevealedAt)}`
              : " · not viewed yet"}
          </p>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {c.canReveal && !revealed && (
              <button type="button" onClick={() => void reveal()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--g-accent)] px-3 py-1.5 text-xs font-semibold text-[#0A0E14] hover:bg-[var(--g-hover)] disabled:opacity-60">
                {busy === "reveal" ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                Show login
              </button>
            )}
            {c.canEdit && (
              <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5">
                Replace
              </button>
            )}
            {c.canDelete && (
              <button type="button" onClick={() => void remove()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-rose-300 disabled:opacity-60">
                <Trash2 className="size-3.5" /> Remove
              </button>
            )}
          </div>
          {data.viewer.role === "booster" && !c.canReveal && (
            <p className="text-[11px] text-zinc-500">
              {c.sessionRequired
                ? "Start a session to view the login. Every view is logged."
                : "Available while the order is in progress (not while paused)."}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          {isCustomer
            ? "This order is finished; account details are no longer kept."
            : "The customer has not added the account login yet. Ask them in the chat."}
        </p>
      )}
    </PanelOrSection>
  );
}
