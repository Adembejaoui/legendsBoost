"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseDecimalToMinor, toDecimalString } from "@/lib/money";

const input = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";

/** Approve (cancel + refund) or reject one cancellation request. */
export function CancellationDecision({
  requestId,
  paid,
  currency,
  suggestedRefund,
}: {
  requestId: string;
  paid: number;
  currency: string;
  /** Full amount when no work started; null = the admin decides from progress. */
  suggestedRefund: number | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(suggestedRefund !== null ? toDecimalString(suggestedRefund, currency) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setMessage(null);
    let body: Record<string, unknown>;
    if (decision === "approve") {
      let refundAmount: number;
      try {
        refundAmount = amount.trim() ? parseDecimalToMinor(amount.trim(), currency) : 0;
      } catch {
        setMessage("Enter the refund as an amount like 12.50 (0 for no refund).");
        return;
      }
      if (refundAmount > paid) {
        setMessage("The refund cannot be more than the amount paid.");
        return;
      }
      const ok = window.confirm(`Cancel this order and refund ${toDecimalString(refundAmount, currency)} ${currency}? This cannot be undone.`);
      if (!ok) return;
      body = { decision, refundAmount, ...(note.trim() ? { note: note.trim() } : {}) };
    } else {
      if (note.trim().length < 3) {
        setMessage("Write a short note for the customer explaining why.");
        return;
      }
      body = { decision, note: note.trim() };
    }
    setBusy(decision);
    try {
      const res = await fetch(`/api/admin/cancellation-requests/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the decision");
      if (data.refundError) {
        setMessage(`Order cancelled, but the refund failed: ${data.refundError}. Retry it from the refund tool of the order.`);
      }
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save the decision");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-zinc-400">
          Refund ({currency})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${input} ml-2 w-28`} />
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the customer"
          maxLength={1000}
          className={`${input} min-w-0 flex-1`}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("approve")}
          className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy === "approve" ? "Approving…" : "Approve: cancel + refund"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("reject")}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {message ? (
        <p role="alert" className="text-xs text-amber-300">
          {message}
        </p>
      ) : null}
    </div>
  );
}
