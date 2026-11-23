"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

const input = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";
const btn = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export interface StatusAction {
  to: string;
  label: string;
  tone: "primary" | "neutral" | "danger";
  needsNote: boolean;
}

/** Status buttons for the moves the transition table allows from the current status. */
export function BoosterStatusActions({ userId, current, actions }: { userId: string; current: string; actions: StatusAction[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(a: StatusAction) {
    if (a.needsNote && note.trim().length < 3) {
      setError("Write a note first (it is shown to the booster or kept on record).");
      return;
    }
    if (a.tone === "danger" && !window.confirm(`${a.label}?`)) return;
    setBusy(a.to);
    setError(null);
    try {
      await send(`/api/admin/boosters/${userId}/status`, "POST", { to: a.to, note: note.trim() || undefined, expectedFrom: current });
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) return <p className="text-sm text-zinc-500">No further changes are possible from this status.</p>;
  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Note (required to request info, reject, suspend or terminate; shown to the booster for info requests and rejections)"
        className={`${input} w-full`}
      />
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.to}
            type="button"
            disabled={busy !== null}
            onClick={() => void act(a)}
            className={`${btn} ${a.tone === "primary" ? "bg-[#C8AA6E] text-[#0A0E14]" : a.tone === "danger" ? "bg-rose-500 text-white" : "bg-white/10 text-white"}`}
          >
            {busy === a.to ? "Saving…" : a.label}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

export interface RankOption {
  tierId: string;
  tierName: string;
  divisions: { id: string; label: string }[];
}

export interface PermissionGame {
  gameSlug: string;
  gameName: string;
  tiers: RankOption[];
  services: { slug: string; title: string }[];
  current: { tierId: string; divisionId: string | null; regions: string[]; serviceSlugs: string[] } | null;
}

/** Per-game ceiling editor (admin). */
export function PermissionEditor({ userId, game, regions }: { userId: string; game: PermissionGame; regions: string[] }) {
  const router = useRouter();
  const [tierId, setTierId] = useState(game.current?.tierId ?? "");
  const [divisionId, setDivisionId] = useState<string>(game.current?.divisionId ?? "");
  const [selRegions, setSelRegions] = useState<string[]>(game.current?.regions ?? []);
  const [selServices, setSelServices] = useState<string[]>(game.current?.serviceSlugs ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tier = game.tiers.find((t) => t.tierId === tierId);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await send(`/api/admin/boosters/${userId}/permissions`, "PUT", {
        gameSlug: game.gameSlug,
        maxTargetRank: { tierId, divisionId: tier && tier.divisions.length > 0 ? divisionId || tier.divisions[tier.divisions.length - 1].id : null },
        regions: selRegions,
        serviceSlugs: selServices,
      });
      setMsg("Saved");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${game.gameName} for this booster?`)) return;
    setBusy(true);
    try {
      await send(`/api/admin/boosters/${userId}/permissions?gameSlug=${encodeURIComponent(game.gameSlug)}`, "DELETE");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-36 text-sm font-semibold">{game.gameName}</span>
        <label className="text-xs text-zinc-400">
          Highest target rank
          <select value={tierId} onChange={(e) => { setTierId(e.target.value); setDivisionId(""); }} className={`${input} ml-2`}>
            <option value="">Choose…</option>
            {game.tiers.map((t) => (
              <option key={t.tierId} value={t.tierId}>{t.tierName}</option>
            ))}
          </select>
        </label>
        {tier && tier.divisions.length > 0 ? (
          <select value={divisionId || tier.divisions[tier.divisions.length - 1].id} onChange={(e) => setDivisionId(e.target.value)} className={input}>
            {tier.divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <span className="mr-1 text-zinc-500">Regions (none = all):</span>
        {regions.map((r) => (
          <button key={r} type="button" onClick={() => toggle(selRegions, setSelRegions, r)} className={`rounded px-1.5 py-0.5 ${selRegions.includes(r) ? "bg-violet-500/30 text-white" : "bg-white/5 text-zinc-400"}`}>
            {r}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <span className="mr-1 text-zinc-500">Services (none = all):</span>
        {game.services.map((s) => (
          <button key={s.slug} type="button" onClick={() => toggle(selServices, setSelServices, s.slug)} className={`rounded px-1.5 py-0.5 ${selServices.includes(s.slug) ? "bg-violet-500/30 text-white" : "bg-white/5 text-zinc-400"}`}>
            {s.title}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !tierId} onClick={() => void save()} className={`${btn} bg-white text-black`}>
          {game.current ? "Save" : "Add game"}
        </button>
        {game.current ? (
          <button type="button" disabled={busy} onClick={() => void remove()} className={`${btn} bg-white/10 text-zinc-300`}>
            Remove game
          </button>
        ) : null}
        {msg ? <span className="text-xs text-zinc-400">{msg}</span> : null}
      </div>
    </div>
  );
}

/** Active order limit for one booster (null = the default from config). */
export function OrderLimitControl({ userId, current, defaultLimit }: { userId: string; current: number | null; defaultLimit: number }) {
  const router = useRouter();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await send(`/api/admin/boosters/${userId}/limit`, "PUT", { maxConcurrentOrders: value === "" ? null : Number(value) });
      setMsg("Saved");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Active orders at once:</span>
      <select value={value} onChange={(e) => setValue(e.target.value)} className={input}>
        <option value="">Default ({defaultLimit})</option>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button type="button" disabled={busy} onClick={() => void save()} className={`${btn} bg-white text-black`}>
        Save
      </button>
      {msg ? <span className="text-xs text-zinc-400">{msg}</span> : null}
    </div>
  );
}

/** Mock KYC decision buttons (admin). */
export function KycControls({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(next: string) {
    setBusy(true);
    try {
      await send(`/api/admin/boosters/${userId}/kyc`, "POST", { status: next });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Identity check: <strong>{status.replace("_", " ").toLowerCase()}</strong></span>
      {status !== "VERIFIED" ? (
        <button type="button" disabled={busy} onClick={() => void set("VERIFIED")} className={`${btn} bg-emerald-500/80 text-white`}>Mark verified</button>
      ) : null}
      {status !== "REJECTED" ? (
        <button type="button" disabled={busy} onClick={() => void set("REJECTED")} className={`${btn} bg-white/10 text-white`}>Mark rejected</button>
      ) : null}
    </div>
  );
}
