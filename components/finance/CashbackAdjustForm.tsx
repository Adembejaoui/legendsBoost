"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { SITE_CURRENCIES } from "@/lib/currency/currencies";

/** Admin: add (+) or remove (-) a customer's cashback, with a reason. */
export function CashbackAdjustForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState<string>(SITE_CURRENCIES[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // "12.40" or "-5" -> minor units (all site currencies have 2 decimals).
  const cents = /^-?\d+([.,]\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount.trim().replace(",", ".")) * 100) : null;
  const valid = email.includes("@") && cents !== null && cents !== 0 && note.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/finance/cashback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), currency, amount: cents, note: note.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; available?: number };
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      setMsg({ ok: true, text: `Saved. Available now: ${((body.available ?? 0) / 100).toFixed(2)} ${currency}.` });
      setAmount("");
      setNote("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  const input = "h-9 rounded-md border border-white/10 bg-black/30 px-2.5 text-sm text-white outline-none focus:border-white/30";
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[2fr_auto_1fr]">
      <input className={input} type="email" placeholder="Customer email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Customer email" />
      <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
        {SITE_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input className={input} inputMode="decimal" placeholder="Amount (e.g. 5 or -5)" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
      <input className={`${input} sm:col-span-2`} placeholder="Reason (shown to the customer)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} aria-label="Reason" />
      <button type="submit" disabled={!valid || busy} className="h-9 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">
        {busy ? "Saving…" : "Save"}
      </button>
      {msg ? <p className={`text-xs sm:col-span-3 ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p> : null}
    </form>
  );
}
