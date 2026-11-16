"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";

/** Create a discount code. Amounts are decimals ("10", "9.99") in the chosen currency. */
export function CouponCreateForm({ services }: { services: { gameSlug: string; serviceSlug: string; label: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => (String(f.get(k) ?? "").trim() || undefined);
    const n = (k: string) => (s(k) ? Number(s(k)) : undefined);
    const scope = s("scope")?.split(":");
    const body = {
      code: s("code"),
      type,
      ...(type === "PERCENT" ? { percent: n("percent") } : { amount: s("amount") }),
      currency: s("currency") ?? "USD",
      maxDiscount: s("maxDiscount"),
      minSubtotal: s("minSubtotal"),
      maxRedemptions: n("maxRedemptions"),
      perCustomerLimit: n("perCustomerLimit") ?? 1,
      gameSlug: scope?.[0],
      serviceSlug: scope?.[1],
      startsAt: s("startsAt"),
      expiresAt: s("expiresAt"),
      note: s("note"),
    };
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/finance/coupons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the code");
      setOk(`Created ${data.coupon.code}`);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-zinc-400">
        Code
        <input name="code" required minLength={3} maxLength={32} placeholder="WELCOME10" className={`${input} mt-1 uppercase`} />
      </label>
      <label className="text-xs text-zinc-400">
        Type
        <select value={type} onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")} className={`${input} mt-1`}>
          <option value="PERCENT">Percent off</option>
          <option value="FIXED">Fixed amount off</option>
        </select>
      </label>
      {type === "PERCENT" ? (
        <label className="text-xs text-zinc-400">
          Percent (1-100)
          <input name="percent" type="number" step="0.5" min="0.5" max="100" required className={`${input} mt-1`} />
        </label>
      ) : (
        <label className="text-xs text-zinc-400">
          Amount
          <input name="amount" required placeholder="5.00" className={`${input} mt-1`} />
        </label>
      )}
      <label className="text-xs text-zinc-400">
        Currency
        <input name="currency" defaultValue="USD" maxLength={3} className={`${input} mt-1 uppercase`} />
      </label>
      <label className="text-xs text-zinc-400">
        Max discount (optional)
        <input name="maxDiscount" placeholder="20.00" className={`${input} mt-1`} />
      </label>
      <label className="text-xs text-zinc-400">
        Minimum order (optional)
        <input name="minSubtotal" placeholder="30.00" className={`${input} mt-1`} />
      </label>
      <label className="text-xs text-zinc-400">
        Total uses (optional)
        <input name="maxRedemptions" type="number" min="1" className={`${input} mt-1`} />
      </label>
      <label className="text-xs text-zinc-400">
        Uses per customer
        <input name="perCustomerLimit" type="number" min="1" max="100" defaultValue={1} className={`${input} mt-1`} />
      </label>
      <label className="text-xs text-zinc-400">
        Valid for
        <select name="scope" defaultValue="" className={`${input} mt-1`}>
          <option value="">All services</option>
          {services.map((s) => (
            <option key={`${s.gameSlug}:${s.serviceSlug}`} value={`${s.gameSlug}:${s.serviceSlug}`}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-zinc-400">
        Starts (optional)
        <input name="startsAt" type="datetime-local" className={`${input} mt-1`} />
      </label>
      <label className="text-xs text-zinc-400">
        Expires (optional)
        <input name="expiresAt" type="datetime-local" className={`${input} mt-1`} />
      </label>
      <label className="text-xs text-zinc-400">
        Note (internal)
        <input name="note" maxLength={200} className={`${input} mt-1`} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={busy} className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
          {busy ? "Creating…" : "Create code"}
        </button>
        {error ? <span role="alert" className="text-sm text-rose-400">{error}</span> : null}
        {ok ? <span className="text-sm text-emerald-400">{ok}</span> : null}
      </div>
    </form>
  );
}

export function CouponToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/admin/finance/coupons/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={() => void toggle()} disabled={busy} className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 disabled:opacity-50">
      {active ? "Deactivate" : "Activate"}
    </button>
  );
}
