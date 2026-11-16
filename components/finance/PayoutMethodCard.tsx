"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";
const btn = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

type MethodType = "PAYPAL" | "IBAN" | "CRYPTO";

export interface PayoutReadiness {
  kycStatus: string;
  method: { type: string; hint: string; setAt: string; lockedUntil: string | null } | null;
}

/**
 * Booster: payout requirements (verified identity, saved payout method) and
 * the payout method form. Details are sent once and stored encrypted; only a
 * masked hint is ever shown again.
 */
export function PayoutMethodCard({ readiness }: { readiness: PayoutReadiness }) {
  const router = useRouter();
  const { method, kycStatus } = readiness;
  const [editing, setEditing] = useState(!method);
  const [type, setType] = useState<MethodType>("PAYPAL");
  const [email, setEmail] = useState("");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [network, setNetwork] = useState("USDT_TRC20");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (method && !window.confirm("Changing your payout method pauses payouts for 48 hours. Continue?")) return;
    const body = type === "PAYPAL" ? { type, email } : type === "IBAN" ? { type, holder, iban } : { type, network, address };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/booster/payout-method", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save");
      setEditing(false);
      setEmail("");
      setIban("");
      setAddress("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const methodLine = !method
    ? "• Add a payout method below"
    : method.lockedUntil
      ? `• Payout method changed: payouts available again after ${new Date(method.lockedUntil).toLocaleString()}`
      : `✓ Paid to ${method.hint}`;

  return (
    <section className="mb-6 space-y-3 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white">
      <h2 className="font-semibold">Before you can request a payout</h2>
      <ul className="space-y-1">
        <li className={kycStatus === "VERIFIED" ? "text-emerald-300" : "text-amber-300"}>
          {kycStatus === "VERIFIED" ? "✓ Identity verified" : "• Verify your identity (Profile → Identity verification)"}
        </li>
        <li className={method && !method.lockedUntil ? "text-emerald-300" : "text-amber-300"}>{methodLine}</li>
      </ul>

      {method && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-300">{method.hint}</span>
          <button type="button" onClick={() => setEditing(true)} className={`${btn} bg-white/10 text-white`}>
            Change
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(["PAYPAL", "IBAN", "CRYPTO"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`${btn} ${type === t ? "bg-[#C8AA6E] text-[#0A0E14]" : "bg-white/10 text-white"}`}
              >
                {t === "PAYPAL" ? "PayPal" : t === "IBAN" ? "Bank (IBAN)" : "Crypto"}
              </button>
            ))}
          </div>
          {type === "PAYPAL" ? (
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="PayPal email" className={`${input} w-full`} autoComplete="off" />
          ) : type === "IBAN" ? (
            <div className="flex flex-wrap gap-2">
              <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Account holder" className={`${input} flex-1`} autoComplete="off" />
              <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IBAN" className={`${input} flex-1`} autoComplete="off" spellCheck={false} />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select value={network} onChange={(e) => setNetwork(e.target.value)} className={input} aria-label="Network">
                <option value="USDT_TRC20">USDT (TRC20)</option>
                <option value="USDT_ERC20">USDT (ERC20)</option>
                <option value="BTC">Bitcoin</option>
              </select>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wallet address" className={`${input} flex-1`} autoComplete="off" spellCheck={false} />
            </div>
          )}
          <p className="text-xs text-zinc-500">Stored encrypted. Double-check it: payouts are sent to exactly these details.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className={`${btn} bg-[#C8AA6E] text-[#0A0E14]`}>
              {busy ? "Saving…" : "Save payout method"}
            </button>
            {method ? (
              <button type="button" onClick={() => setEditing(false)} className={`${btn} bg-white/10 text-zinc-300`}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      )}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </section>
  );
}

/** Admin: show the payout details copied on a payout (audited reveal). */
export function RevealPayoutMethod({ payoutId, hint }: { payoutId: string; hint: string | null }) {
  const [details, setDetails] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!hint) return <span className="text-zinc-500">—</span>;

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/payouts/${payoutId}/method`, { method: "POST", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not load");
      setDetails((data as { details: Record<string, string> }).details);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setBusy(false);
    }
  }

  const lines = details
    ? Object.entries(details)
        .filter(([k]) => k !== "type")
        .map(([k, v]) => `${k}: ${v}`)
    : [];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span>{hint}</span>
        {!details ? (
          <button type="button" disabled={busy} onClick={() => void reveal()} className="text-xs text-violet-300 hover:underline">
            {busy ? "…" : "Show details"}
          </button>
        ) : null}
      </div>
      {details ? (
        <code className="block break-all rounded bg-black/30 p-1.5 text-xs text-zinc-200">
          {lines.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </code>
      ) : null}
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </div>
  );
}
