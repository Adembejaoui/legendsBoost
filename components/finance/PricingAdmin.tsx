"use client";

/**
 * Admin forms: new service price version and new commission policy.
 * Amounts are entered as decimals and converted to integer minor units
 * without floating point (lib/money parseDecimalToMinor).
 */
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Loader2 } from "lucide-react";
import { parseDecimalToMinor } from "@/lib/money";

const input = "w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-[#C8AA6E]/60";

export interface PriceFormService {
  gameSlug: string;
  serviceSlug: string;
  title: string;
  rankTiers: { id: string; name: string }[] | null;
  numberFields: { key: string; label: string }[];
  options: { id: string; label: string }[];
  modes: { id: string; label: string }[];
  active: {
    currency: string;
    pricingModel: string;
    baseAmount: string;
    unitFieldKey: string | null;
    unitAmount: string | null;
    stepAmounts: Record<string, string>;
    optionPricing: Record<string, { type: string; value: string }>;
    modePricing: Record<string, { type: string; value: string }>;
  } | null;
}

type Adj = { type: "fixed" | "bps"; value: string };

export function ServicePriceForm({ service }: { service: PriceFormService }) {
  const router = useRouter();
  const a = service.active;
  const [currency, setCurrency] = useState(a?.currency ?? "EUR");
  const [model, setModel] = useState(a?.pricingModel ?? (service.rankTiers ? "RANK_STEPS" : service.numberFields.length ? "PER_UNIT" : "FIXED"));
  const [base, setBase] = useState(a?.baseAmount ?? "");
  const [unitField, setUnitField] = useState(a?.unitFieldKey ?? service.numberFields[0]?.key ?? "");
  const [unitAmount, setUnitAmount] = useState(a?.unitAmount ?? "");
  const [steps, setSteps] = useState<Record<string, string>>(a?.stepAmounts ?? {});
  const [options, setOptions] = useState<Record<string, Adj>>((a?.optionPricing ?? {}) as Record<string, Adj>);
  const [modes, setModes] = useState<Record<string, Adj>>((a?.modePricing ?? {}) as Record<string, Adj>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function adjustments(map: Record<string, Adj>) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map)) {
      if (!v.value.trim()) continue; // left empty = not purchasable
      out[k] = v.type === "fixed" ? { type: "fixed", amount: parseDecimalToMinor(v.value, currency) } : { type: "bps", bps: Math.round(Number(v.value) * 100) };
    }
    return out;
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        gameSlug: service.gameSlug,
        serviceSlug: service.serviceSlug,
        currency: currency.toUpperCase(),
        pricingModel: model,
        baseAmount: parseDecimalToMinor(base || "0", currency),
        optionPricing: adjustments(options),
        modePricing: adjustments(modes),
      };
      if (model === "RANK_STEPS") {
        body.stepAmounts = Object.fromEntries(Object.entries(steps).filter(([, v]) => v.trim()).map(([k, v]) => [k, parseDecimalToMinor(v, currency)]));
      }
      if (model === "PER_UNIT") {
        body.unitFieldKey = unitField;
        body.unitAmount = parseDecimalToMinor(unitAmount || "0", currency);
      }
      const res = await fetch("/api/admin/finance/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.details?.join(" ") ?? data.error ?? "Save failed");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const adjRow = (id: string, label: string, map: Record<string, Adj>, set: (m: Record<string, Adj>) => void) => (
    <div key={id} className="flex items-center gap-2 text-sm">
      <span className="w-48 truncate text-zinc-300">{label}</span>
      <select className="rounded-md border border-white/10 bg-black/30 px-1 py-1 text-xs" value={map[id]?.type ?? "fixed"} onChange={(e) => set({ ...map, [id]: { type: e.target.value as Adj["type"], value: map[id]?.value ?? "" } })}>
        <option value="fixed">{currency} amount</option>
        <option value="bps">% of service price</option>
      </select>
      <input className={`${input} w-28`} placeholder="unpriced" value={map[id]?.value ?? ""} onChange={(e) => set({ ...map, [id]: { type: map[id]?.type ?? "fixed", value: e.target.value } })} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4">
        <label className="text-xs text-zinc-400">Currency<input className={input} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        <label className="text-xs text-zinc-400">Model
          <select className={input} value={model} onChange={(e) => setModel(e.target.value)}>
            {service.rankTiers ? <option value="RANK_STEPS">Per rank step</option> : null}
            {service.numberFields.length ? <option value="PER_UNIT">Per unit</option> : null}
            <option value="FIXED">Fixed</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400">Base price<input className={input} value={base} placeholder="0.00" onChange={(e) => setBase(e.target.value)} /></label>
        {model === "PER_UNIT" ? (
          <label className="text-xs text-zinc-400">Unit price
            <div className="flex gap-1">
              <select className={input} value={unitField} onChange={(e) => setUnitField(e.target.value)}>
                {service.numberFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <input className={input} value={unitAmount} placeholder="0.00" onChange={(e) => setUnitAmount(e.target.value)} />
            </div>
          </label>
        ) : null}
      </div>
      {model === "RANK_STEPS" && service.rankTiers ? (
        <div>
          <p className="mb-1 text-xs text-zinc-400">Price per step starting in each tier (empty = that range is not purchasable)</p>
          <div className="grid gap-2 md:grid-cols-4">
            {service.rankTiers.map((t) => (
              <label key={t.id} className="text-xs text-zinc-400">{t.name}<input className={input} value={steps[t.id] ?? ""} placeholder="unpriced" onChange={(e) => setSteps({ ...steps, [t.id]: e.target.value })} /></label>
            ))}
          </div>
        </div>
      ) : null}
      {service.modes.length ? <div className="space-y-1"><p className="text-xs text-zinc-400">Modes (empty = not purchasable)</p>{service.modes.map((m) => adjRow(m.id, m.label, modes, setModes))}</div> : null}
      {service.options.length ? <div className="space-y-1"><p className="text-xs text-zinc-400">Options (empty = not purchasable; 0 = free)</p>{service.options.map((o) => adjRow(o.id, o.label, options, setOptions))}</div> : null}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-[#C8AA6E] px-3 py-1.5 text-sm font-semibold text-[#0A0E14] disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save as new version
        </button>
        {saved ? <span className="text-sm text-emerald-300">Saved.</span> : null}
        {error ? <span role="alert" className="text-sm text-rose-400">{error}</span> : null}
      </div>
    </div>
  );
}

export function CommissionForm({ currentPlatformBps }: { currentPlatformBps: number | null }) {
  const router = useRouter();
  const [percent, setPercent] = useState(currentPlatformBps !== null ? String(currentPlatformBps / 100) : "45");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bps = Math.round(Number(percent) * 100);
  const valid = Number.isFinite(bps) && bps >= 0 && bps <= 10000 && /^\d{1,3}(\.\d{1,2})?$/.test(percent);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/commission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformFeeBps: bps, note: note.trim() || undefined, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">Platform commission %<input className={`${input} w-28`} value={percent} onChange={(e) => setPercent(e.target.value)} /></label>
        <span className="pb-2 text-sm text-zinc-400">Booster share {valid ? `${(10000 - bps) / 100}%` : "—"}</span>
        <label className="flex-1 text-xs text-zinc-400">Note<input className={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {!confirming ? (
        <button type="button" disabled={!valid} onClick={() => setConfirming(true)} className="rounded-md bg-white/10 px-3 py-1.5 text-sm disabled:opacity-50">Change commission…</button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm">
          <span>Applies to orders created from now on. Existing orders keep their own snapshot.</span>
          <button type="button" disabled={busy} onClick={() => void save()} className="rounded-md bg-[#C8AA6E] px-3 py-1 font-semibold text-[#0A0E14]">Confirm</button>
          <button type="button" onClick={() => setConfirming(false)} className="text-zinc-400">Cancel</button>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-rose-400">{error}</p> : null}
    </div>
  );
}
