"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Image as ImageIcon, Undo2 } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const btn =
  "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
}

function Proofs({ proofs }: { proofs: { id: string; url: string }[] }) {
  if (proofs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {proofs.map((p, i) => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noopener"
          className="group relative block h-20 w-32 overflow-hidden rounded-md border border-white/10 bg-black/40 sm:h-24 sm:w-40"
          title="Open the screenshot"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the app */}
          <img src={p.url} alt={`Proof screenshot ${i + 1}`} loading="lazy" className="size-full object-cover transition group-hover:scale-105" />
        </a>
      ))}
    </div>
  );
}

/**
 * Completion with proof (decision 2026-11-16): the booster's screenshots,
 * and what each side can do while the order waits for confirmation.
 */
export function CompletionPanel({ data }: { data: WorkspaceDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const { completion, order, viewer } = data;
  const r = completion.request;
  const [mode, setMode] = useState<"idle" | "dispute" | "send_back">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!r) return null;
  const waiting = order.status === "AWAITING_CONFIRMATION" && (r.status === "PENDING" || r.status === "DISPUTED");
  const sentBack = r.status === "SENT_BACK" && order.status === "IN_PROGRESS";
  if (!waiting && !sentBack) return null;

  async function act(kind: string, fn: () => Promise<void>, done: { title: string; description: string; type: "success" | "warning" | "info" }) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      toast(done);
      setMode("idle");
      setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const confirm = () =>
    act("confirm", () => post(`/api/orders/${order.id}/completion`, { action: "confirm" }), {
      type: "success",
      title: "Order confirmed",
      description: "Thank you! You can now leave a review for your booster.",
    });
  const dispute = () =>
    act("dispute", () => post(`/api/orders/${order.id}/completion`, { action: "dispute", reason: text.trim() }), {
      type: "warning",
      title: "Problem reported",
      description: "Our team will review the screenshots and get back to you.",
    });
  const accept = () =>
    act("accept", () => post(`/api/admin/completions/${r.id}`, { action: "accept" }), {
      type: "success",
      title: "Order completed",
      description: "The customer and the booster were notified.",
    });
  const sendBack = () =>
    act("send_back", () => post(`/api/admin/completions/${r.id}`, { action: "send_back", note: text.trim() }), {
      type: "info",
      title: "Sent back to the booster",
      description: "The order is in progress again.",
    });

  if (sentBack) {
    return (
      <section role="status" className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        <Undo2 className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div>
          <p className="font-semibold text-amber-50">Sent back to the booster by our team</p>
          {r.adminNote ? <p className="mt-0.5 text-amber-100/90">{r.adminNote}</p> : null}
        </div>
      </section>
    );
  }

  const disputed = r.status === "DISPUTED";
  const tone = disputed ? "border-amber-400/30 bg-amber-500/[0.08]" : "border-[rgba(var(--g-rgb),0.35)] bg-[rgba(var(--g-rgb),0.07)]";

  let title: string;
  let line: React.ReactNode;
  if (viewer.role === "customer") {
    title = disputed ? "You reported a problem" : "Your booster finished the order";
    line = disputed ? (
      "Our team is reviewing the screenshots and will get back to you. If everything is fine after all, you can still confirm."
    ) : (
      <>
        Check the screenshots below. Confirm if the result is right, or report a problem. Without an answer, the order confirms
        automatically on <b>{when(r.autoConfirmAt)}</b>.
      </>
    );
  } else if (viewer.role === "booster") {
    title = disputed ? "The customer reported a problem" : "Waiting for the customer to confirm";
    line = disputed ? (
      "An admin will review your screenshots and contact you if needed."
    ) : (
      <>
        Do not play on the account anymore. The order confirms automatically on <b>{when(r.autoConfirmAt)}</b> if the customer does
        not answer.
      </>
    );
  } else {
    title = disputed ? "Completion disputed by the customer" : "Waiting for the customer to confirm";
    line = disputed ? "Review the screenshots and the customer's reason, then complete the order or send it back." : (
      <>Auto-confirms on {when(r.autoConfirmAt)}.</>
    );
  }

  return (
    <section aria-label="Order completion" className={cn("space-y-3 rounded-xl border px-4 py-3.5 text-sm", tone)}>
      <div className="flex items-start gap-3">
        {disputed ? (
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" />
        ) : (
          <Clock className="mt-0.5 size-5 shrink-0 text-[var(--g-accent)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{title}</p>
          <p className="mt-0.5 text-zinc-300">{line}</p>
        </div>
      </div>

      <div className="space-y-2 sm:pl-8">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400">
          <ImageIcon className="size-3.5" /> Final rank screenshots
        </p>
        <Proofs proofs={r.proofs} />
        {r.boosterNote ? (
          <p className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-zinc-300">
            <span className="text-zinc-500">Booster: </span>
            {r.boosterNote}
          </p>
        ) : null}
        {disputed && r.disputeReason && viewer.role !== "customer" ? (
          <p className="rounded-md border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-amber-100">
            <span className="text-amber-300/80">Customer: </span>
            {r.disputeReason}
          </p>
        ) : null}
      </div>

      {(completion.canConfirm || completion.canDecide) && (
        <div className="space-y-2 sm:pl-8">
          {mode !== "idle" && (
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">
                {mode === "dispute" ? "What is wrong? (at least 10 characters)" : "What should the booster fix? (sent to the booster and the customer)"}
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={1000}
                autoFocus
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
            </label>
          )}
          {error ? <p role="alert" className="text-xs text-rose-400">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            {completion.canConfirm && mode === "idle" && (
              <button type="button" onClick={() => void confirm()} disabled={busy !== null} className={cn(btn, "bg-[var(--g-accent)] font-semibold text-[var(--g-on)] hover:bg-[var(--g-hover)]")}>
                <CheckCircle2 className="size-4" /> {busy === "confirm" ? "Confirming…" : "Confirm, all good"}
              </button>
            )}
            {completion.canDispute && mode === "idle" && (
              <button type="button" onClick={() => setMode("dispute")} disabled={busy !== null} className={cn(btn, "border border-amber-400/40 text-amber-200 hover:bg-amber-400/10")}>
                <AlertTriangle className="size-4" /> Report a problem
              </button>
            )}
            {completion.canDecide && mode === "idle" && (
              <>
                <button type="button" onClick={() => void accept()} disabled={busy !== null} className={cn(btn, "bg-emerald-500 font-semibold text-black hover:bg-emerald-400")}>
                  <CheckCircle2 className="size-4" /> {busy === "accept" ? "Completing…" : "Complete order"}
                </button>
                <button type="button" onClick={() => setMode("send_back")} disabled={busy !== null} className={cn(btn, "border border-amber-400/40 text-amber-200 hover:bg-amber-400/10")}>
                  <Undo2 className="size-4" /> Send back to booster
                </button>
              </>
            )}
            {mode === "dispute" && (
              <button type="button" onClick={() => void dispute()} disabled={busy !== null || text.trim().length < 10} className={cn(btn, "bg-amber-400 font-semibold text-black hover:bg-amber-300")}>
                {busy === "dispute" ? "Sending…" : "Send to our team"}
              </button>
            )}
            {mode === "send_back" && (
              <button type="button" onClick={() => void sendBack()} disabled={busy !== null || text.trim().length < 5} className={cn(btn, "bg-amber-400 font-semibold text-black hover:bg-amber-300")}>
                {busy === "send_back" ? "Sending…" : "Send back"}
              </button>
            )}
            {mode !== "idle" && (
              <button type="button" onClick={() => { setMode("idle"); setText(""); setError(null); }} disabled={busy !== null} className={cn(btn, "text-zinc-300 hover:bg-white/[0.06]")}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
