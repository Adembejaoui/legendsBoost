"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";
const btn = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Booster: appeal a fine once. */
export function AppealForm({ fineId }: { fineId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btn} bg-white/10 text-white`}>
        Appeal
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Explain why this fine is not justified (links to proof welcome)" className={`${input} w-full`} />
      <div className="flex gap-2">
        <button type="button" disabled={busy || text.trim().length < 10} onClick={() => void run(() => send(`/api/booster/fines/${fineId}/appeal`, "POST", { text: text.trim() }))} className={`${btn} bg-[#C8AA6E] text-[#0A0E14]`}>
          Send appeal
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${btn} bg-white/10 text-zinc-300`}>
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

/** Admin: decide an appeal, or reverse a fine. */
export function FineDecision({ fineId, appealed, reversible }: { fineId: string; appealed: boolean; reversible: boolean }) {
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  const act = (action: "accept_appeal" | "reject_appeal" | "reverse") => {
    if (note.trim().length < 3) return;
    if (action !== "reject_appeal" && !window.confirm("Refund this fine to the booster?")) return;
    void run(() => send(`/api/admin/fines/${fineId}`, "POST", { action, note: note.trim() })).then((ok) => ok && setNote(""));
  };
  if (!appealed && !reversible) return null;
  return (
    <div className="space-y-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Decision note (required)" className={`${input} w-full`} />
      <div className="flex flex-wrap gap-2">
        {appealed ? (
          <>
            <button type="button" disabled={busy || note.trim().length < 3} onClick={() => act("accept_appeal")} className={`${btn} bg-emerald-500/80 text-white`}>
              Accept appeal (refund)
            </button>
            <button type="button" disabled={busy || note.trim().length < 3} onClick={() => act("reject_appeal")} className={`${btn} bg-white/10 text-white`}>
              Reject appeal
            </button>
          </>
        ) : (
          <button type="button" disabled={busy || note.trim().length < 3} onClick={() => act("reverse")} className={`${btn} bg-white/10 text-white`}>
            Reverse fine
          </button>
        )}
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

/** Admin: remove a strike. */
export function RemoveStrike({ strikeId }: { strikeId: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const reason = window.prompt("Why remove this strike?");
          if (reason && reason.trim().length >= 3) void run(() => send(`/api/admin/strikes/${strikeId}`, "DELETE", { reason: reason.trim() }));
        }}
        className="text-xs text-zinc-400 hover:text-white"
      >
        Remove
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </span>
  );
}

/** Admin: issue a fine from the schedule. */
export function IssueFineForm({
  userId,
  orders,
  schedule,
}: {
  userId: string;
  orders: { id: string; label: string }[];
  schedule: { code: string; label: string; amount: number }[];
}) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [code, setCode] = useState(schedule[0]?.code ?? "");
  const [amount, setAmount] = useState(((schedule[0]?.amount ?? 0) / 100).toFixed(2));
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  if (orders.length === 0) return <p className="text-sm text-zinc-500">This booster has not worked on any order yet.</p>;
  const cents = Math.round(Number(amount.replace(",", ".")) * 100);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={input} aria-label="Order">
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setAmount(((schedule.find((s) => s.code === e.target.value)?.amount ?? 0) / 100).toFixed(2));
          }}
          className={input}
          aria-label="Rule"
        >
          {schedule.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${input} w-24`} aria-label="Amount" />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="What happened (shown to the booster)" className={`${input} w-full`} />
      <button
        type="button"
        disabled={busy || note.trim().length < 5 || !(cents > 0)}
        onClick={() => {
          if (!window.confirm(`Fine this booster ${amount}?`)) return;
          void run(() => send(`/api/admin/boosters/${userId}/fines`, "POST", { orderId, code, amount: cents, note: note.trim() })).then((ok) => ok && setNote(""));
        }}
        className={`${btn} bg-rose-500 text-white`}
      >
        Issue fine
      </button>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}
