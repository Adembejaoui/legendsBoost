"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/** Admin: complete a submitted order, or send it back to the booster with a note. */
export function CompletionDecision({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [back, setBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "accept" | "send_back") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/completions/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "accept" ? { action } : { action, note: note.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
      toast(
        action === "accept"
          ? { type: "success", title: "Order completed", description: "The customer and the booster were notified." }
          : { type: "info", title: "Sent back", description: "The order is in progress again." }
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {back && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="What should the booster fix? (sent to the booster and the customer)"
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
        />
      )}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!back ? (
          <>
            <button type="button" disabled={busy} onClick={() => void decide("accept")} className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">
              {busy ? "Saving…" : "Complete order"}
            </button>
            <button type="button" disabled={busy} onClick={() => setBack(true)} className="rounded-md border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/10 disabled:opacity-50">
              Send back to booster
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || note.trim().length < 5} onClick={() => void decide("send_back")} className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-300 disabled:opacity-50">
              {busy ? "Sending…" : "Send back"}
            </button>
            <button type="button" disabled={busy} onClick={() => setBack(false)} className="rounded-md px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
