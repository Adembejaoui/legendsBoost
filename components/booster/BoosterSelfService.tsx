"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SelfPermission {
  gameSlug: string;
  gameName: string;
  ceilingLabel: string;
  /** Ranks at or below the current ceiling (the booster may only lower it). */
  lowerOptions: { tierId: string; divisionId: string | null; label: string }[];
  regions: string[];
  services: string[];
}

const card = "space-y-3 rounded-xl border border-white/10 bg-white/5 p-5";
const btn = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

/** Booster status, break mode, rank ceilings (lower only) and identity check. */
export function BoosterSelfService({
  status,
  statusLabel,
  trialOrdersRemaining,
  kycStatus,
  permissions,
  displayName,
}: {
  status: string;
  statusLabel: string;
  trialOrdersRemaining: number | null;
  kycStatus: string;
  permissions: SelfPermission[];
  displayName: string | null;
}) {
  const [name, setName] = useState(displayName ?? "");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white">{statusLabel}</span>
          {status === "TRIAL" ? (
            <span className="text-sm text-zinc-300">
              Trial: {trialOrdersRemaining ?? 0} order{trialOrdersRemaining === 1 ? "" : "s"} left before an admin reviews your work.
            </span>
          ) : null}
          {status === "APPROVED" || status === "ON_BREAK" ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("break", () => send("/api/booster/break", "POST", { onBreak: status === "APPROVED" }))}
              className={`${btn} ${status === "ON_BREAK" ? "bg-[#C8AA6E] text-[#0A0E14]" : "bg-white/10 text-white"}`}
            >
              {status === "ON_BREAK" ? "End my break" : "Take a break"}
            </button>
          ) : null}
        </div>
        {status === "ON_BREAK" ? (
          <p className="text-xs text-zinc-400">On a break you keep your current orders but receive no new ones.</p>
        ) : null}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">Public name</h2>
        <p className="text-xs text-zinc-400">
          Customers can choose you at checkout by this name. Never use your real name. Leave it empty to not be listed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="e.g. MidGapKing"
            aria-label="Public name"
            className="h-9 w-56 rounded-md border border-white/10 bg-black/30 px-2.5 text-sm text-white outline-none focus:border-white/30"
          />
          <button
            type="button"
            disabled={busy !== null || name.trim() === (displayName ?? "")}
            onClick={() => void run("name", () => send("/api/booster/profile", "PATCH", { displayName: name.trim() }))}
            className={`${btn} bg-white/10 text-white`}
          >
            Save
          </button>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">Games and rank ceilings</h2>
        <p className="text-xs text-zinc-400">
          The highest target rank you may take per game. You can lower it at any time; ask an admin to raise it.
        </p>
        {permissions.length === 0 ? (
          <p className="text-sm text-zinc-500">No games set yet. An admin will set them.</p>
        ) : (
          permissions.map((p) => (
            <div key={p.gameSlug} className="flex flex-wrap items-center gap-2 rounded-md bg-black/20 p-2 text-sm">
              <span className="w-36 font-medium text-white">{p.gameName}</span>
              <span className="text-zinc-300">Up to {p.ceilingLabel}</span>
              <span className="text-xs text-zinc-500">
                {p.regions.length ? p.regions.join(", ") : "all regions"} · {p.services.length ? p.services.join(", ") : "all services"}
              </span>
              {p.lowerOptions.length > 0 ? (
                <span className="ml-auto flex items-center gap-2">
                  <select
                    value={picks[p.gameSlug] ?? ""}
                    onChange={(e) => setPicks({ ...picks, [p.gameSlug]: e.target.value })}
                    className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                  >
                    <option value="">Lower to…</option>
                    {p.lowerOptions.map((o) => (
                      <option key={`${o.tierId}:${o.divisionId ?? ""}`} value={`${o.tierId}:${o.divisionId ?? ""}`}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!picks[p.gameSlug] || busy !== null}
                    onClick={() => {
                      const [tierId, div] = picks[p.gameSlug].split(":");
                      if (!window.confirm("Lower your ceiling? Only an admin can raise it again.")) return;
                      void run(`lower:${p.gameSlug}`, () =>
                        send("/api/booster/permissions", "PATCH", { gameSlug: p.gameSlug, maxTargetRank: { tierId, divisionId: div || null } })
                      );
                    }}
                    className={`${btn} bg-white/10 text-white`}
                  >
                    Lower
                  </button>
                </span>
              ) : null}
            </div>
          ))
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">Identity verification</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
          <span>Status: {kycStatus.replace("_", " ").toLowerCase()}</span>
          {kycStatus === "NOT_STARTED" || kycStatus === "REJECTED" ? (
            <button type="button" disabled={busy !== null} onClick={() => void run("kyc", () => send("/api/booster/kyc", "POST"))} className={`${btn} bg-white/10 text-white`}>
              Start verification
            </button>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">Required before your first payout. Our team checks it and updates the status.</p>
      </section>

      {error ? <p role="alert" className="text-sm text-rose-400">{error}</p> : null}
    </div>
  );
}
