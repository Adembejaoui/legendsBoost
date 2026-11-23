"use client";

import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

type RankValue = { tierId: string; divisionId: string | null };

export interface DraftEditorProps {
  order: {
    id: string;
    status: string;
    serviceTitle: string;
    customer: string;
    configuration: Record<string, unknown>;
    selectedOptions: string[];
    selectedMode: string | null;
    price: string;
    currency: string;
    /** Server-verified payment exists. Republishing is blocked without it. */
    paymentVerified: boolean;
    /** Priced (paid) order: the amount is what the customer paid and cannot be edited. */
    priceLocked: boolean;
  };
  abandonReason: string | null;
  fields: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    min?: number;
    max?: number;
    options?: { label: string; value: string }[];
  }[];
  tiers: { id: string; name: string; divisions: { id: string; label: string }[] }[];
  checkoutOptions: { id: string; label: string }[];
  modes: { id: string; label: string }[];
  history: { id: string; type: string; message: string | null; createdAt: string }[];
}

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#C8AA6E]/60 disabled:opacity-50";

export function DraftEditor(p: DraftEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const isDraft = p.order.status === "DRAFT";
  const [config, setConfig] = useState<Record<string, unknown>>(p.order.configuration);
  const [options, setOptions] = useState<string[]>(p.order.selectedOptions);
  const [mode, setMode] = useState<string | null>(p.order.selectedMode);
  const [price, setPrice] = useState(p.order.price);
  const [currency, setCurrency] = useState(p.order.currency);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"save" | "publish" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  async function cancelOrder() {
    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${p.order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, reason: cancelReason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Cancel failed");
      toast({ type: "warning", title: "Order cancelled", description: "The customer has been notified." });
      router.push("/dashboard/admin/orders");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${p.order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configuration: config,
          selectedOptions: options,
          selectedMode: mode,
          // A paid order's price is fixed: never sent (corrections = refund).
          ...(p.order.priceLocked
            ? {}
            : {
                price: price.trim() === "" ? null : price.trim(),
                currency: currency.trim() === "" ? null : currency.trim(),
              }),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      toast({ type: "success", title: "Draft saved" });
      setNote("");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!(await save())) return;
    setBusy("publish");
    try {
      const res = await fetch(`/api/admin/orders/${p.order.id}/republish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Republish failed");
      toast({ type: "success", title: "Order republished", description: "It is now available to boosters." });
      router.push("/dashboard/admin/orders");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Republish failed");
      setBusy(null);
      setConfirmPublish(false);
    }
  }

  return (
    <div className="max-w-3xl text-white">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/dashboard/admin/orders" className="grid size-9 place-items-center rounded-lg border border-white/10 text-zinc-400 hover:bg-white/5" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">
            {p.order.serviceTitle} <span className="text-zinc-500">#{p.order.id.slice(-8).toUpperCase()}</span>
          </h1>
          <p className="text-xs text-zinc-500">Customer: {p.order.customer} · Status: {p.order.status}</p>
        </div>
        <Link href={`/dashboard/${p.order.id}`} className="ml-auto text-sm text-violet-300 hover:text-violet-200">
          Open workspace
        </Link>
      </div>

      {!isDraft && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
          The configuration can be edited only when the order is a draft (for example after its booster abandoned it). Use
          the order actions above for the booster and the completion.
        </p>
      )}

      {p.abandonReason && (
        <div className="mb-4 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-violet-300">Abandonment reason</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{p.abandonReason}</p>
        </div>
      )}

      <form
        className="space-y-5 rounded-xl border border-white/[0.07] bg-[#11131a] p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!isDraft || busy !== null} className="space-y-4">
          <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Configuration</legend>
          {p.fields.map((f) => {
            const v = config[f.key];
            if (f.type === "rank-picker") {
              const rv = (v as RankValue | undefined) ?? { tierId: "", divisionId: null };
              const tier = p.tiers.find((t) => t.id === rv.tierId);
              return (
                <div key={f.key}>
                  <span className="mb-1 block text-xs text-zinc-400">
                    {f.label}
                    {f.required && " *"}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label={`${f.label} tier`}
                      className={input}
                      value={rv.tierId}
                      onChange={(e) => {
                        const t = p.tiers.find((x) => x.id === e.target.value);
                        setConfig({ ...config, [f.key]: { tierId: e.target.value, divisionId: t?.divisions[0]?.id ?? null } });
                      }}
                    >
                      <option value="">—</option>
                      {p.tiers.map((t) => (
                        <option key={t.id} value={t.id} className="bg-[#11131a]">
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${f.label} division`}
                      className={input}
                      value={rv.divisionId ?? ""}
                      disabled={!tier || tier.divisions.length === 0}
                      onChange={(e) => setConfig({ ...config, [f.key]: { ...rv, divisionId: e.target.value || null } })}
                    >
                      {(tier?.divisions ?? []).map((d) => (
                        <option key={d.id} value={d.id} className="bg-[#11131a]">
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            }
            if (f.type === "select" && f.options) {
              return (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs text-zinc-400">{f.label}</span>
                  <select className={input} value={(v as string) ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value} className="bg-[#11131a]">
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            if (f.type === "number") {
              return (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs text-zinc-400">{f.label}</span>
                  <input
                    type="number"
                    className={input}
                    min={f.min}
                    max={f.max}
                    value={v === undefined || v === null ? "" : String(v)}
                    onChange={(e) => setConfig({ ...config, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </label>
              );
            }
            return (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs text-zinc-400">{f.label}</span>
                <input className={input} value={(v as string) ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
              </label>
            );
          })}

          {p.modes.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Boost mode</span>
              <select className={input} value={mode ?? ""} onChange={(e) => setMode(e.target.value || null)}>
                <option value="">—</option>
                {p.modes.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#11131a]">
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {p.checkoutOptions.length > 0 && (
            <div>
              <span className="mb-1 block text-xs text-zinc-400">Options</span>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {p.checkoutOptions.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={options.includes(o.id)}
                      onChange={(e) => setOptions(e.target.checked ? [...options, o.id] : options.filter((x) => x !== o.id))}
                      className="accent-[#C8AA6E]"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {p.order.priceLocked ? (
            <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
              <span className="text-zinc-300">
                Paid: {p.order.price || "?"} {p.order.currency}
              </span>
              {" · "}The price of a paid order cannot be changed. Use a refund for corrections.
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Price</span>
                <input className={input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 49.99" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Currency</span>
                <input className={input} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </label>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Audit note (optional)</span>
            <input className={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What did you change and why?" />
          </label>
        </fieldset>

        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

        {isDraft && (
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            <button type="submit" disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5 disabled:opacity-60">
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              Save draft
            </button>
            {!p.order.paymentVerified ? (
              <p className="self-center text-sm text-zinc-400">
                Can&apos;t republish: this order has no verified payment, so it can&apos;t be offered to boosters.
              </p>
            ) : !confirmPublish ? (
              <button type="button" onClick={() => setConfirmPublish(true)} disabled={busy !== null} className="rounded-lg bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[#d8bc85] disabled:opacity-60">
                Republish…
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#C8AA6E]/30 bg-[#C8AA6E]/5 px-3 py-2">
                <span className="text-sm text-zinc-200">Save and make this order available to boosters?</span>
                <button type="button" onClick={() => void publish()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-md bg-[#C8AA6E] px-3 py-1.5 text-sm font-semibold text-[#0A0E14] disabled:opacity-60">
                  {busy === "publish" && <Loader2 className="size-4 animate-spin" />}
                  Confirm republish
                </button>
                <button type="button" onClick={() => setConfirmPublish(false)} disabled={busy !== null} className="text-sm text-zinc-400 hover:text-zinc-200">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {isDraft && (
          <div className="border-t border-white/[0.06] pt-4">
            {!confirmCancel ? (
              <button type="button" onClick={() => setConfirmCancel(true)} disabled={busy !== null} className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-60">
                Cancel order…
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-400">Cancellation reason (required, shown in the audit trail)</span>
                  <input className={input} value={cancelReason} maxLength={500} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why is this order being cancelled?" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void cancelOrder()} disabled={busy !== null || cancelReason.trim().length < 3} className="inline-flex items-center gap-2 rounded-md bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                    {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
                    Confirm cancellation
                  </button>
                  <button type="button" onClick={() => setConfirmCancel(false)} disabled={busy !== null} className="text-sm text-zinc-400 hover:text-zinc-200">
                    Keep order
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>

      {p.history.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Audit trail</h2>
          <ol className="space-y-2">
            {p.history.map((h) => (
              <li key={h.id} className="rounded-lg border border-white/[0.06] bg-[#11131a] px-3 py-2 text-sm">
                <span className="font-medium text-zinc-200">{h.type.replace(/_/g, " ").toLowerCase()}</span>
                {h.message && <span className="text-zinc-400"> — {h.message}</span>}
                <time className="block text-[11px] text-zinc-600">{new Date(h.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
