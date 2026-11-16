"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";

const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
const input = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--g-accent)]/60";
const TIP_PRESETS = [300, 500, 1000];

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");
  return data as Record<string, unknown>;
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={cn("disabled:cursor-default", n <= value ? "text-[var(--g-accent)]" : "text-zinc-600")}
        >
          <Star className="size-5" fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

/** Review (customer), reply (booster), hide (admin) and tips for a completed order. */
export function FeedbackPanel({ data }: { data: WorkspaceDTO }) {
  const f = data.feedback;
  const router = useRouter();
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [tip, setTip] = useState<number>(TIP_PRESETS[1]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = data.order.currency ?? "EUR";

  if (!f.review && !f.canReview && !f.canTip && !f.tipped) return null;

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel dense title="Review and tip" icon={<Star className="size-3.5" />}>
      <div className="space-y-4 text-sm">
        {f.review ? (
          <div className="space-y-2">
            <Stars value={f.review.rating} />
            {f.review.hidden ? (
              <p className="text-xs text-amber-300">Hidden by our team{f.review.hiddenReason ? `: ${f.review.hiddenReason}` : ""}.</p>
            ) : null}
            {f.review.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {f.review.tags.map((t) => (
                  <span key={t} className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-zinc-200">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            {f.review.text ? <p className="text-zinc-300">{f.review.text}</p> : null}
            {f.review.reply ? (
              <p className="border-l-2 border-[var(--g-accent)]/40 pl-2 text-zinc-400">
                <span className="font-semibold text-zinc-300">Booster reply: </span>
                {f.review.reply}
              </p>
            ) : null}
            {f.canReply ? (
              <div className="space-y-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={1000} placeholder="Reply to this review (once, public)" className={input} />
                <button
                  type="button"
                  disabled={busy !== null || reply.trim().length < 2}
                  onClick={() => void run("reply", async () => {
                    await post(`/api/reviews/${f.review!.id}/reply`, { reply: reply.trim() });
                    router.refresh();
                  })}
                  className={`${btn} bg-white/10 text-white`}
                >
                  Reply
                </button>
              </div>
            ) : null}
            {f.canHide ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const hide = !f.review!.hidden;
                  const reason = hide ? window.prompt("Why hide this review?") : "";
                  if (hide && (!reason || reason.trim().length < 3)) return;
                  void run("hide", async () => {
                    await post(`/api/admin/reviews/${f.review!.id}`, { hidden: hide, ...(hide ? { reason: reason!.trim() } : {}) });
                    router.refresh();
                  });
                }}
                className={`${btn} bg-white/10 text-zinc-300`}
              >
                {f.review.hidden ? "Show review" : "Hide review"}
              </button>
            ) : null}
          </div>
        ) : f.canReview ? (
          <div className="space-y-2">
            <p className="text-zinc-300">How was your boost?</p>
            <Stars value={rating} onChange={setRating} />
            <div className="flex flex-wrap gap-1">
              {f.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
                  className={cn("rounded-md px-2 py-0.5 text-xs", tags.includes(t) ? "bg-[var(--g-accent)]/25 text-[var(--g-light)]" : "bg-white/5 text-zinc-400")}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="Tell other players about your booster (optional, public)" className={input} />
            <button
              type="button"
              disabled={busy !== null || rating === 0}
              onClick={() => void run("review", async () => {
                await post(`/api/orders/${data.order.id}/review`, { rating, tags, ...(text.trim() ? { text: text.trim() } : {}) });
                toast({ type: "success", title: "Thanks for your review" });
                router.refresh();
              })}
              className={`${btn} bg-[var(--g-accent)] text-[#0A0E14]`}
            >
              {busy === "review" ? "Sending…" : "Send review"}
            </button>
          </div>
        ) : null}

        {f.tipped ? (
          <p className="text-xs text-emerald-300">
            {data.viewer.role === "booster" ? "Tips received: " : "You tipped: "}
            {money(f.tipped.amount, f.tipped.currency)}
          </p>
        ) : null}

        {f.canTip ? (
          <div className="space-y-2 border-t border-white/10 pt-3">
            <p className="text-zinc-300">Tip your booster</p>
            <div className="flex flex-wrap items-center gap-2">
              {TIP_PRESETS.map((a) => (
                <button key={a} type="button" onClick={() => setTip(a)} className={cn(btn, tip === a ? "bg-[var(--g-accent)] text-[#0A0E14]" : "bg-white/10 text-white")}>
                  {money(a, currency)}
                </button>
              ))}
              <input
                inputMode="decimal"
                aria-label="Other amount"
                placeholder="Other"
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value.replace(",", ".")) * 100);
                  if (Number.isFinite(v) && v > 0) setTip(v);
                }}
                className="h-8 w-20 rounded-lg border border-white/10 bg-black/30 px-2 text-sm text-white"
              />
              <button
                type="button"
                disabled={busy !== null || tip < 100}
                onClick={() => void run("tip", async () => {
                  const r = await post(`/api/orders/${data.order.id}/tip`, { amount: tip });
                  window.location.assign(String(r.url));
                })}
                className={`${btn} bg-[var(--g-accent)] text-[#0A0E14]`}
              >
                {busy === "tip" ? "Opening payment…" : `Tip ${money(tip, currency)}`}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="text-xs text-rose-400">{error}</p> : null}
      </div>
    </Panel>
  );
}
