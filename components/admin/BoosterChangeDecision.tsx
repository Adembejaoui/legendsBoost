"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";

/** Approve (release the booster) or reject one booster change request. */
export function BoosterChangeDecision({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setMessage(null);
    if (decision === "reject" && note.trim().length < 3) {
      setMessage("Write a short note for the customer explaining why.");
      return;
    }
    if (decision === "approve" && !window.confirm("Remove this booster and put the order back on the marketplace?")) return;
    setBusy(decision);
    try {
      const res = await fetch(`/api/admin/booster-change-requests/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the decision");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save the decision");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note to the customer (required to reject)"
        aria-label="Note to the customer"
        maxLength={1000}
        className={`${input} w-full`}
      />
      <div className="flex gap-2">
        <button type="button" disabled={busy !== null} onClick={() => void decide("approve")} className="rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {busy === "approve" ? "Approving…" : "Approve: change booster"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void decide("reject")} className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white disabled:opacity-50">
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
