"use client";

import { useEffect, useState } from "react";

type Status = { pending: { id: string; requestedAt: string } | null; blockers: string[] };

/**
 * GDPR: ask to delete the account. An admin approves; personal data is then
 * anonymised (orders and money records are kept without a name or email).
 */
export function DeleteAccountCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/account/deletion", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => {
        if (alive && d) setStatus(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/deletion", {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
      setOpen(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] p-5 text-sm">
      <h2 className="font-semibold text-white">Delete my account</h2>
      <p className="text-zinc-400">
        We remove your name, email, sign-in, profile, payout details and saved game logins. Orders and payment records are kept without your
        personal details, because we must keep accounting records.
      </p>
      {status?.pending ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-amber-300">Requested on {new Date(status.pending.requestedAt).toLocaleDateString()}: our team will process it.</span>
          <button type="button" disabled={busy} onClick={() => void call("DELETE")} className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
            Cancel request
          </button>
        </div>
      ) : status && status.blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-amber-300">
          {status.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : open ? (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why are you leaving? (optional)"
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void call("POST")} className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white">
              {busy ? "Sending…" : "Request deletion"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-zinc-300">
              Keep my account
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={!status} onClick={() => setOpen(true)} className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-rose-300">
          Delete my account
        </button>
      )}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </section>
  );
}
