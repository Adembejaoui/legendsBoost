"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Eye, EyeOff, Gamepad2, Loader2, ShieldCheck } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { Panel } from "./Panel";
import { RiotAccountPanel } from "./RiotAccountPanel";
import { AccountAccessPanel } from "./AccountAccessPanel";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--g-accent)]/60";

/**
 * Everything the booster needs about the game account, in one box:
 *  1. Riot ID (game name + tag) and server: public, for the OP.GG /
 *     tracker.gg check link (no Riot API, decision 2026-11-17);
 *  2. Login (username + password): encrypted, only for the active booster.
 * A customer who has entered neither gets one combined form.
 */
export function GameAccountPanel({ data }: { data: WorkspaceDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const isCustomer = data.viewer.role === "customer";
  const firstTime =
    isCustomer &&
    !data.riot.account &&
    !data.credentials.saved &&
    data.access.canEditRiotAccount &&
    data.credentials.canEdit;

  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [platform, setPlatform] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r1 = await fetch(`/api/orders/${data.order.id}/game-account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameName, tagLine, platform }),
      });
      const b1 = await r1.json().catch(() => ({}));
      if (!r1.ok) {
        // Checked on Riot before anything is saved: nothing stored yet.
        if (typeof b1.suggestedPlatform === "string") setPlatform(b1.suggestedPlatform);
        throw new Error(b1.error ?? "Could not save the Riot ID");
      }

      const r2 = await fetch(`/api/orders/${data.order.id}/account-credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const b2 = await r2.json().catch(() => ({}));
      if (!r2.ok) {
        router.refresh(); // Riot ID is saved; show the remaining login form
        throw new Error(`Riot ID saved, but the login was not: ${b2.error ?? "error"}`);
      }
      setPassword("");
      toast({
        type: "success",
        title: "Game account saved",
        description: b1.warning ?? "Riot account found. Your login is encrypted and only visible to your booster.",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel dense title="Game account" icon={<Gamepad2 className="size-3.5" />}>
      {firstTime ? (
        <form onSubmit={submit} className="space-y-3" autoComplete="off">
          <p className="text-xs text-zinc-400">Your booster needs these details to play and track your account.</p>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Riot ID &amp; server</legend>
            <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Game name</span>
                <input className={input} value={gameName} onChange={(e) => setGameName(e.target.value)} required minLength={3} maxLength={16} autoComplete="off" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Tag</span>
                <div className="flex items-center rounded-lg border border-white/10 bg-black/30 focus-within:border-[var(--g-accent)]/60">
                  <span className="pl-2 text-sm text-zinc-500">#</span>
                  <input
                    className="w-full bg-transparent px-1.5 py-2 text-sm text-white outline-none"
                    value={tagLine}
                    onChange={(e) => setTagLine(e.target.value.replace(/^#/, ""))}
                    required
                    minLength={3}
                    maxLength={5}
                    autoComplete="off"
                  />
                </div>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Server</span>
              <select className={input} value={platform} onChange={(e) => setPlatform(e.target.value)} required>
                <option value="" disabled>Select server</option>
                {data.riot.platforms.map((p) => (
                  <option key={p.value} value={p.value} className="bg-[#11131a]">{p.label}</option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Login</legend>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Username</span>
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
          </fieldset>

          <p className="flex gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-zinc-400">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--g-accent)]" />
            The login is encrypted, visible only to your booster while they work on this order, every view is logged, and
            it is deleted when the order is completed. Change your password afterwards.
          </p>
          {!data.credentials.configured && <p role="alert" className="text-xs text-rose-300">Secure storage is not configured on the server yet.</p>}
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || !data.credentials.configured}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--g-accent)] px-3.5 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[var(--g-hover)] disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save game account
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <RiotAccountPanel data={data} embedded />
          <div className="border-t border-white/[0.06] pt-3">
            <AccountAccessPanel data={data} embedded />
          </div>
        </div>
      )}
    </Panel>
  );
}
