"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

const STEPS = [
  { step: "contact", label: "1. No message (45 min)", hint: "Booster alert with sound, if they have not messaged you yet." },
  { step: "email", label: "2. Warning email (2 h)", hint: "Email and notification to the booster." },
  { step: "final", label: "3. Final warning (23 h)", hint: "\"Taken back in 1 hour\", email and notification." },
  { step: "release", label: "4. Take back + fine (24 h)", hint: "Real: the order leaves the booster and the fine is issued." },
] as const;

/**
 * Test tool (STALL_TEST_TOOLS=1 only, the order's customer): run each stalled
 * order step now instead of waiting. Rendered by the order page only when the
 * server flag is on.
 */
export function StallTestPanel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(step: string) {
    if (step === "release" && !window.confirm("This really takes the order from the booster and fines them. Continue?")) return;
    setBusy(step);
    setMsg(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/stall-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step }),
      });
      const body = (await res.json().catch(() => ({}))) as { done?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      setMsg({ ok: !!body.done, text: body.message ?? "Done." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-6xl rounded-xl border border-dashed border-amber-400/50 bg-amber-500/5 p-4">
      <h2 className="text-sm font-semibold text-amber-200">Test: stalled order automation</h2>
      <p className="mt-1 text-xs text-amber-100/70">
        Runs each step now as if the time had passed. Everything is real (notifications, emails, fine). Turn off STALL_TEST_TOOLS when you are done.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <button
            key={s.step}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(s.step)}
            title={s.hint}
            className={`rounded-md px-3 py-2 text-start text-xs font-semibold disabled:opacity-50 ${
              s.step === "release" ? "bg-rose-500/80 text-white hover:bg-rose-500" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            {busy === s.step ? "Running…" : s.label}
            <span className="mt-0.5 block font-normal text-zinc-300">{s.hint}</span>
          </button>
        ))}
      </div>
      {msg ? <p className={`mt-3 text-xs ${msg.ok ? "text-emerald-300" : "text-amber-200"}`}>{msg.text}</p> : null}
    </section>
  );
}
