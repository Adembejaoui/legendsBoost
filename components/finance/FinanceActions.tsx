"use client";

/**
 * Small client controls for the admin finance dashboard. Every action calls
 * an ADMIN-only API that re-checks the role on the server.
 */
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Loader2 } from "lucide-react";

const btn = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50";
const input = "rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none focus:border-[#C8AA6E]/60";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, body: unknown, headers: Record<string, string> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
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

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-key`);

export function ApproveEarningButton({ earningId }: { earningId: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={busy} onClick={() => void run(`/api/admin/finance/earnings/${earningId}`, { action: "approve" })} className={`${btn} bg-emerald-500/20 text-emerald-200`}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : null} Release
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </span>
  );
}

export function AllocateEarningForm({
  earningId,
  netAmount,
  assignments,
  suggestion,
}: {
  earningId: string;
  netAmount: number;
  assignments: { id: string; label: string }[];
  /** Pre-filled split by progress (Phase 7); the admin confirms or edits it. */
  suggestion?: { basis: string; amounts: Record<string, number> } | null;
}) {
  const { busy, error, run } = useAction();
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    suggestion ? Object.fromEntries(Object.entries(suggestion.amounts).map(([k, v]) => [k, String(v)])) : {}
  );
  const [note, setNote] = useState(suggestion ? `Split by ${suggestion.basis}` : "");
  const total = Object.values(amounts).reduce((a, v) => a + (Number.parseInt(v || "0", 10) || 0), 0);
  return (
    <div className="space-y-1.5">
      {suggestion ? (
        <p className="text-xs text-amber-300">Suggested from {suggestion.basis}. Check it before allocating.</p>
      ) : (
        <p className="text-xs text-zinc-500">No measurable progress to suggest a split: enter the amounts.</p>
      )}
      {assignments.map((a) => (
        <label key={a.id} className="flex items-center gap-2 text-xs">
          <span className="w-56 truncate text-zinc-300">{a.label}</span>
          <input className={`${input} w-28`} inputMode="numeric" placeholder="minor units" value={amounts[a.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value.replace(/[^0-9]/g, "") })} />
        </label>
      ))}
      <input className={`${input} w-full`} placeholder="Allocation note (required)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <div className="flex items-center gap-2 text-xs">
        <span className={total === netAmount ? "text-emerald-300" : "text-zinc-400"}>
          {total} / {netAmount}
        </span>
        <button
          type="button"
          disabled={busy || total !== netAmount || note.trim().length < 3}
          onClick={() =>
            void run(`/api/admin/finance/earnings/${earningId}`, {
              action: "allocate",
              note: note.trim(),
              allocations: assignments.map((a) => ({ assignmentId: a.id, amount: Number.parseInt(amounts[a.id] || "0", 10) || 0 })),
            })
          }
          className={`${btn} bg-[#C8AA6E] text-[#0A0E14]`}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null} Allocate
        </button>
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

export function PayoutActions({ payoutId, status }: { payoutId: string; status: string }) {
  const { busy, error, run } = useAction();
  const [mode, setMode] = useState<"none" | "paid" | "reject" | "fail">("none");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const url = `/api/admin/finance/payouts/${payoutId}`;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {status === "REQUESTED" ? <button type="button" disabled={busy} onClick={() => void run(url, { action: "approve" })} className={`${btn} bg-emerald-500/20 text-emerald-200`}>Approve</button> : null}
        {status === "APPROVED" ? <button type="button" disabled={busy} onClick={() => void run(url, { action: "processing" })} className={`${btn} bg-white/10`}>Mark processing</button> : null}
        {status === "APPROVED" || status === "PROCESSING" ? <button type="button" disabled={busy} onClick={() => setMode("paid")} className={`${btn} bg-[#C8AA6E] text-[#0A0E14]`}>Record payment…</button> : null}
        {status === "REQUESTED" || status === "APPROVED" ? <button type="button" disabled={busy} onClick={() => setMode("reject")} className={`${btn} bg-rose-500/20 text-rose-200`}>Reject…</button> : null}
        {status === "PROCESSING" ? <button type="button" disabled={busy} onClick={() => setMode("fail")} className={`${btn} bg-rose-500/20 text-rose-200`}>Mark failed…</button> : null}
      </div>
      {mode === "paid" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input className={input} placeholder="Method (e.g. bank_transfer)" value={method} onChange={(e) => setMethod(e.target.value)} />
          <input className={input} placeholder="External reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          <input className={`${input} w-64`} placeholder="Evidence (statement line, receipt id…)" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          <button
            type="button"
            disabled={busy || !method.trim() || !reference.trim() || evidence.trim().length < 3}
            onClick={async () => (await run(url, { action: "paid", method: method.trim(), externalReference: reference.trim(), evidence: evidence.trim() })) && setMode("none")}
            className={`${btn} bg-[#C8AA6E] text-[#0A0E14]`}
          >
            Confirm paid
          </button>
        </div>
      ) : null}
      {mode === "reject" || mode === "fail" ? (
        <div className="flex items-center gap-1.5">
          <input className={`${input} w-64`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => (await run(url, { action: mode === "reject" ? "reject" : "fail", reason: reason.trim() })) && setMode("none")}
            className={`${btn} bg-rose-500/30 text-rose-100`}
          >
            Confirm
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

export function RefundForm({ orderId, paymentId, maxAmount, currency }: { orderId: string; paymentId: string; maxAmount: number; currency: string }) {
  const { busy, error, run } = useAction();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const n = Number.parseInt(amount || "0", 10) || 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input className={`${input} w-28`} inputMode="numeric" placeholder={`max ${maxAmount}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} />
      <span className="text-xs text-zinc-500">{currency} minor units</span>
      <input className={`${input} w-56`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        type="button"
        disabled={busy || n <= 0 || n > maxAmount || reason.trim().length < 3}
        onClick={async () => {
          if (await run(`/api/admin/orders/${orderId}/refunds`, { amount: n, reason: reason.trim(), paymentId }, { "Idempotency-Key": key })) {
            setAmount("");
            setReason("");
            setKey(newKey());
          }
        }}
        className={`${btn} bg-rose-500/20 text-rose-200`}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null} Refund
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </div>
  );
}

export function RetryEventButton({ eventId }: { eventId: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void run(`/api/admin/finance/events/${eventId}/retry`, {})} className={`${btn} bg-white/10`}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : null} Retry
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </span>
  );
}

export function OutboxButtons() {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void run("/api/admin/finance/outbox", { action: "dispatch" })} className={`${btn} bg-white/10`}>Dispatch pending</button>
      <button type="button" disabled={busy} onClick={() => void run("/api/admin/finance/outbox", { action: "requeue-failed" })} className={`${btn} bg-white/10`}>Requeue failed</button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </span>
  );
}
