"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { boosterFinance } from "@/lib/finance/queries";

type Data = Awaited<ReturnType<typeof boosterFinance>>;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting release",
  ON_HOLD: "On hold (dispute)",
  AVAILABLE: "Available",
  IN_PAYOUT: "In payout",
  PAID: "Paid",
  REVERSED: "Reversed (refund)",
  RESERVED: "Order in progress",
  PENDING_REVIEW: "Under review",
};

function addMaps(a: Record<string, number>, b: Record<string, number>) {
  const out: Record<string, number> = { ...a };
  for (const [c, v] of Object.entries(b)) out[c] = (out[c] ?? 0) + v;
  return out;
}

function money(map: Record<string, number>) {
  const entries = Object.entries(map).filter(([, v]) => v !== 0);
  if (entries.length === 0) return formatMoney(0, "EUR");
  return entries.map(([c, v]) => formatMoney(v, c)).join(" · ");
}

export function BoosterEarnings({ data }: { data: Data }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = data.totals;
  const openPayout = data.payouts.find((p) => ["REQUESTED", "APPROVED", "PROCESSING"].includes(p.status));
  const finesDue: Record<string, number> = t.finesDue ?? {};
  // What a payout really pays: available earnings minus unpaid fines.
  const payable = Object.fromEntries(Object.entries(t.available).map(([c, v]) => [c, v - (finesDue[c] ?? 0)]));
  const availableCurrencies = Object.entries(payable).filter(([, v]) => v > 0).map(([c]) => c);
  const finesBlocked = Object.entries(t.available).some(([c, v]) => v > 0 && payable[c] <= 0);

  async function request(currency: string) {
    setBusy(currency);
    setError(null);
    try {
      const res = await fetch("/api/booster/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Payout request failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payout request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your share of completed orders. Earnings are released by our team after review, then you can request a manual payout.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Awaiting release", money(addMaps(t.pending, t.onHold))],
          ["Available", money(payable)],
          ["In payout", money(t.inPayout)],
          ["Paid", money(t.paid)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-zinc-400">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {Object.keys(finesDue).length > 0 ? (
        <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          Unpaid fines of {money(finesDue)} are taken off your next payout. Available already shows the amount after fines.
        </p>
      ) : null}

      {Object.values(t.ledgerBalance).some((v) => v < 0) ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          A refund on an already paid order left an outstanding balance of {money(Object.fromEntries(Object.entries(t.ledgerBalance).filter(([, v]) => v < 0)))}. It is settled against future earnings.
        </p>
      ) : null}

      <section className="mt-6 rounded-xl border border-white/10 bg-white/3 p-5">
        <h2 className="text-lg font-semibold">Payout</h2>
        {openPayout ? (
          <p className="mt-2 text-sm text-zinc-300">
            Your payout of {formatMoney(openPayout.amount, openPayout.currency)} is <strong>{openPayout.status.toLowerCase()}</strong>.
          </p>
        ) : availableCurrencies.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">
            {finesBlocked ? "Your unpaid fines are equal to or more than your available earnings. Earn more or appeal a fine first." : "Nothing is available for payout yet."}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {availableCurrencies.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => void request(c)}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-md bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14] disabled:opacity-60"
              >
                {busy === c ? <Loader2 className="size-4 animate-spin" /> : null}
                Request payout of {formatMoney(payable[c], c)}
              </button>
            ))}
          </div>
        )}
        {error ? <p role="alert" className="mt-2 text-sm text-rose-400">{error}</p> : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Earnings per order</h2>
        {data.earnings.length === 0 ? (
          <p className="text-sm text-zinc-500">No earnings yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-160 text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Share</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {data.earnings.map((e) => (
                  <tr key={e.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono">{e.orderRef}</td>
                    <td className="px-3 py-2">{e.service}</td>
                    <td className="px-3 py-2">{e.boosterShareBps / 100}%</td>
                    <td className="px-3 py-2">
                      {formatMoney(e.netAmount, e.currency)}
                      {e.reversedAmount > 0 ? <span className="ml-1 text-xs text-zinc-500">({formatMoney(e.grossAmount, e.currency)} before refunds)</span> : null}
                    </td>
                    <td className="px-3 py-2">{STATUS_LABEL[e.status] ?? e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Payout history</h2>
        {data.payouts.length === 0 ? (
          <p className="text-sm text-zinc-500">No payouts yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/3 px-4 py-3 text-sm">
                <span>{formatMoney(p.amount, p.currency)}</span>
                <span className="text-zinc-400">{new Date(p.requestedAt).toLocaleDateString()}</span>
                <span className="font-medium">{p.status.toLowerCase()}</span>
                {p.status === "PAID" && p.externalReference ? <span className="text-xs text-zinc-500">Ref {p.externalReference}</span> : null}
                {p.rejectionReason ? <span className="text-xs text-rose-300">{p.rejectionReason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
