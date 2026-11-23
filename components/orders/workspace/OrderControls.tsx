"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { BellRing, CheckCircle2, Coins, ImagePlus, LogOut, Pause, Play, UserRoundCog, X } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { shrinkImage } from "./shrink-image";

const MAX_PROOFS = 3;

type Dialog = "pause" | "complete" | "abandon" | "tip" | "booster-change" | "not-confirmed" | null;

const TIP_PRESETS = [300, 500, 1000];

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const btn =
  "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const primary = "bg-[var(--g-accent)] font-semibold text-[#0A0E14] hover:bg-[var(--g-hover)]";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      (data as { error?: string }).error || "Something went wrong. Try again.",
    );
  return data as Record<string, unknown>;
}

/**
 * Order-management controls for the workspace header.
 *
 *  - Customer (client PDF 2026-11-21): Tip, Pause / Resume, Change booster
 *    (admin-reviewed) and Poke booster (email, once per hour), always shown
 *    side by side and greyed out with a hint when they do not apply.
 *    Customers cannot cancel; cancellations go through support / admin.
 *  - Booster:  Start (claimed order), then Complete / Abandon. Both disabled while the customer has the
 *    order paused. Claiming happens in the marketplace.
 *
 * Visibility follows the server-computed access flags; every API call is
 * re-authorised and re-validated server-side.
 */
export function OrderControls({ data }: { data: WorkspaceDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notConfirmed, setNotConfirmed] = useState<{ message: string; reason: string; current: string | null; target: string | null } | null>(null);
  const { access, order, viewer, assignment } = data;
  const paused = order.status === "PAUSED";
  const [tip, setTip] = useState<number>(TIP_PRESETS[1]);
  // Poke cooldown: the later of the server's time and the last poke from
  // this page; "now" ticks once when it ends so the button comes back.
  const [localPokeAt, setLocalPokeAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const serverPokeAt = data.customerActions?.nextPokeAt ?? null;
  const pokeAt = [serverPokeAt, localPokeAt].filter((x): x is string => !!x).sort().pop() ?? null;
  const pokedUntil = pokeAt && new Date(pokeAt).getTime() > now ? pokeAt : null;
  useEffect(() => {
    if (!pokedUntil) return;
    const t = setTimeout(() => setNow(Date.now()), new Date(pokedUntil).getTime() - Date.now() + 50);
    return () => clearTimeout(t);
  }, [pokedUntil]);
  // Booster completion: 1-3 screenshots of the final rank + optional note.
  const [proofs, setProofs] = useState<File[]>([]);
  const previews = useMemo(() => proofs.map((p) => URL.createObjectURL(p)), [proofs]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  function addProofs(list: FileList | null) {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setProofs((cur) => [...cur, ...images].slice(0, MAX_PROOFS));
  }

  function open(d: Dialog) {
    setError(null);
    setReason("");
    if (d === "complete") setProofs([]);
    setDialog(d);
  }

  /** fn may return true to keep a dialog it opened itself. */
  async function run(kind: string, fn: () => Promise<void | boolean>) {
    setBusy(kind);
    setError(null);
    try {
      const keepDialog = await fn();
      if (keepDialog !== true) setDialog(null);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Something went wrong. Try again.";
      if (dialog) setError(message);
      else
        toast({
          title: "Action failed",
          description: message,
          type: "destructive",
        });
    } finally {
      setBusy(null);
    }
  }

  const pause = () =>
    run("pause", async () => {
      const r = await post(`/api/orders/${order.id}/pause`);
      toast({
        type: "warning",
        title: "Order paused",
        description:
          r.changed === false
            ? "The order was already paused."
            : "Your booster has been told to stop playing.",
      });
      router.refresh();
    });

  const resume = () =>
    run("resume", async () => {
      const r = await post(`/api/orders/${order.id}/resume`);
      toast({
        type: "success",
        title: "Order resumed",
        description:
          r.changed === false
            ? "The order was already in progress."
            : "Your booster can continue boosting.",
      });
      router.refresh();
    });

  const poke = () =>
    run("poke", async () => {
      const res = await fetch(`/api/orders/${order.id}/poke`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; nextPokeAt?: string | null };
      if (body.nextPokeAt) {
        setLocalPokeAt(body.nextPokeAt);
        setNow(Date.now());
      }
      if (!res.ok) throw new Error(body.error || "Could not poke your booster.");
      toast({ type: "success", title: "Booster poked", description: "We emailed your booster to check the order chat." });
    });

  const complete = () =>
    run("complete", async () => {
      let res: Response;
      if (viewer.role === "admin") {
        // Admins complete an in-progress order directly.
        res = await fetch(`/api/booster/orders/${order.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId: data.adminCompletion?.assignmentId }),
        });
      } else {
        if (proofs.length === 0) throw new Error("Add at least one screenshot of the final rank.");
        const form = new FormData();
        form.set("assignmentId", assignment?.id ?? "");
        if (reason.trim()) form.set("note", reason.trim());
        for (const [i, p] of proofs.entries()) {
          const small = await shrinkImage(p);
          form.append("proof", small, `proof-${i + 1}.${small.type === "image/jpeg" ? "jpg" : (p.name.split(".").pop() ?? "png")}`);
        }
        res = await fetch(`/api/booster/orders/${order.id}/complete`, { method: "POST", body: form });
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 409 && (body.code === "TARGET_NOT_REACHED" || body.code === "CANNOT_VERIFY")) {
        // Riot did not confirm the target: keep working; an admin will contact the booster.
        setNotConfirmed({
          message: String(body.error ?? ""),
          reason: String(body.reason ?? ""),
          current: (body.current as string | null) ?? null,
          target: (body.target as string | null) ?? null,
        });
        setDialog("not-confirmed");
        return true;
      }
      if (!res.ok) throw new Error((body.error as string) || "Something went wrong. Try again.");
      const pending = (body.completion as { status?: string } | undefined)?.status === "PENDING";
      toast({
        type: "success",
        title: pending ? "Sent for review" : "Order completed",
        description: pending
          ? "The customer sees your screenshots; an admin marks the order Completed. Stop playing on the account."
          : "The order has been marked as complete.",
      });
      setProofs([]);
      router.refresh();
    });

  const start = () =>
    run("start", async () => {
      await post(`/api/booster/orders/${order.id}/start`);
      toast({ type: "success", title: "Order started", description: "The customer has been told you started." });
      router.refresh();
    });

  // Set by the server only while the free window is still open (the server decides the strike anyway).
  const inGrace = !!data.releaseGraceUntil;
  const abandon = () =>
    run("abandon", async () => {
      await post(`/api/booster/orders/${order.id}/abandon`, {
        assignmentId: assignment?.id,
        reason: reason.trim() || (inGrace ? "Released within the free window" : reason),
      });
      toast({
        type: "warning",
        title: "Order abandoned",
        description:
          "It has been sent to our team for review. You no longer have access to it.",
      });
      router.push("/dashboard/booster/claimed-orders");
    });


  const isBoosterWorking =
    viewer.role === "booster" && access.canManageAssignment && assignment;
  const controls: React.ReactNode[] = [];

  if (viewer.role === "customer") {
    const ca = data.customerActions;
    const noBooster = "Available once a booster is assigned";
    const outline = "border border-white/10 text-zinc-200 hover:bg-white/[0.06]";
    const canTip = data.feedback.canTip;
    const change = ca?.boosterChange;
    const changeOpen = change?.latest?.status === "REQUESTED";
    controls.push(
      <button
        key="tip"
        type="button"
        className={cn(btn, outline)}
        onClick={() => open("tip")}
        disabled={!canTip || busy !== null}
        title={canTip ? "Send a tip to your booster" : "You can tip once a booster is working on your order"}
      >
        <Coins className="size-4" /> Tip
      </button>,
      paused && access.canResumeOrder ? (
        <button key="resume" type="button" className={cn(btn, primary)} onClick={() => void resume()} disabled={busy !== null}>
          <Play className="size-4" /> {busy === "resume" ? "Resuming…" : "Resume order"}
        </button>
      ) : (
        <button
          key="pause"
          type="button"
          className={cn(btn, "border border-amber-400/40 text-amber-200 hover:bg-amber-400/10")}
          onClick={() => open("pause")}
          disabled={!access.canPauseOrder || busy !== null}
          title={access.canPauseOrder ? "Put the order on hold until you resume it" : "You can pause once your booster is playing"}
        >
          <Pause className="size-4" /> Pause order
        </button>
      ),
      <button
        key="booster-change"
        type="button"
        className={cn(btn, outline)}
        onClick={() => open("booster-change")}
        disabled={!change?.canRequest || busy !== null}
        title={
          changeOpen
            ? "Your request is being reviewed by our team"
            : !ca?.hasBooster
              ? noBooster
              : change?.latest?.status === "REJECTED" && change.latest.adminNote
                ? `Last request declined: ${change.latest.adminNote}`
                : "Ask our team for a different booster"
        }
      >
        <UserRoundCog className="size-4" /> {changeOpen ? "Change requested" : "Change booster"}
      </button>,
      <button
        key="poke"
        type="button"
        className={cn(btn, outline)}
        onClick={() => void poke()}
        disabled={!ca?.hasBooster || !!pokedUntil || busy !== null}
        title={!ca?.hasBooster ? noBooster : pokedUntil ? `You can poke again at ${timeOf(pokedUntil)}` : "Email your booster to check the order chat"}
      >
        <BellRing className="size-4" /> {busy === "poke" ? "Poking…" : "Poke booster"}
      </button>,
    );
  }

  if (viewer.role === "admin" && data.adminCompletion) {
    controls.push(
      <button key="admin-complete" type="button" className={cn(btn, primary)} onClick={() => open("complete")} disabled={busy !== null}>
        <CheckCircle2 className="size-4" /> Complete order (admin)
      </button>,
    );
  }

  if (isBoosterWorking && access.canStartOrder) {
    controls.push(
      <button key="start" type="button" className={cn(btn, primary)} onClick={() => void start()} disabled={busy !== null}>
        <Play className="size-4" /> {busy === "start" ? "Starting…" : "Start order"}
      </button>,
      <button
        key="abandon"
        type="button"
        className={cn(btn, "border border-rose-500/30 text-rose-300 hover:bg-rose-500/10")}
        onClick={() => open("abandon")}
        disabled={!access.canAbandonOrder || busy !== null}
      >
        <LogOut className="size-4" /> Release
      </button>,
    );
  } else if (isBoosterWorking) {
    const pausedHint = paused
      ? "Paused by the customer. Wait until the order is resumed."
      : undefined;
    controls.push(
      <button
        key="complete"
        type="button"
        className={cn(btn, primary)}
        onClick={() => open("complete")}
        disabled={!access.canCompleteOrder || busy !== null}
        title={pausedHint}
      >
        <CheckCircle2 className="size-4" /> Complete
      </button>,
      <button
        key="abandon"
        type="button"
        className={cn(
          btn,
          "border border-rose-500/30 text-rose-300 hover:bg-rose-500/10",
        )}
        onClick={() => open("abandon")}
        disabled={!access.canAbandonOrder || busy !== null}
        title={pausedHint}
      >
        <LogOut className="size-4" /> Abandon
      </button>,
    );
  }

  if (controls.length === 0) return null;

  return (
    <>
      <div
        role="group"
        aria-label="Order actions"
        className="flex flex-wrap items-center gap-2"
      >
        {controls}
      </div>

      {notConfirmed && (
        <ConfirmDialog
          open={dialog === "not-confirmed"}
          title="The order is not complete yet"
          confirmLabel="I understand"
          tone="amber"
          onConfirm={() => {
            setDialog(null);
            setNotConfirmed(null);
          }}
          onClose={() => {
            setDialog(null);
            setNotConfirmed(null);
          }}
        >
          <p>{notConfirmed.message}</p>
          {notConfirmed.reason ? <p className="mt-2 text-xs text-zinc-400">{notConfirmed.reason}</p> : null}
        </ConfirmDialog>
      )}

      {access.canPauseOrder && (
        <ConfirmDialog
          open={dialog === "pause"}
          title="Pause this order?"
          confirmLabel="Pause order"
          busyLabel="Pausing…"
          tone="amber"
          busy={busy === "pause"}
          error={error}
          onConfirm={() => void pause()}
          onClose={() => setDialog(null)}
        >
          <p>
            Your booster is notified immediately and must stop playing on your
            account until you resume.
          </p>
          <p>
            The order stays assigned to your booster. Nothing is refunded or
            charged, and progress is kept.
          </p>
        </ConfirmDialog>
      )}

      {data.feedback.canTip && (
        <ConfirmDialog
          open={dialog === "tip"}
          title="Tip your booster"
          confirmLabel={`Tip ${money(tip, order.currency ?? "EUR")}`}
          busyLabel="Opening payment…"
          busy={busy === "tip"}
          confirmDisabled={tip < 100}
          error={error}
          onConfirm={() =>
            void run("tip", async () => {
              const r = await post(`/api/orders/${order.id}/tip`, { amount: tip });
              window.location.assign(String(r.url));
              return true;
            })
          }
          onClose={() => setDialog(null)}
        >
          <p>The tip goes to your booster. You pay it securely with Stripe.</p>
          <div className="flex flex-wrap items-center gap-2">
            {TIP_PRESETS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setTip(a)}
                aria-pressed={tip === a}
                className={cn(btn, tip === a ? "bg-[var(--g-accent)] text-[#0A0E14]" : "bg-white/10 text-white")}
              >
                {money(a, order.currency ?? "EUR")}
              </button>
            ))}
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              Other
              <input
                type="number"
                min={1}
                step={1}
                aria-label="Tip amount"
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value) * 100);
                  if (Number.isFinite(v) && v > 0) setTip(v);
                }}
                className="h-9 w-24 rounded-md border border-white/10 bg-black/30 px-2 text-sm text-white outline-none"
              />
            </label>
          </div>
        </ConfirmDialog>
      )}

      {data.customerActions?.boosterChange.canRequest && (
        <ConfirmDialog
          open={dialog === "booster-change"}
          title="Ask for a different booster?"
          confirmLabel="Send request"
          busyLabel="Sending…"
          cancelLabel="Keep my booster"
          busy={busy === "booster-change"}
          error={error}
          onConfirm={() =>
            void run("booster-change", async () => {
              await post(`/api/orders/${order.id}/booster-change`, { reason: reason.trim() });
              toast({ type: "success", title: "Request sent", description: "Our team will review it shortly." });
              router.refresh();
            })
          }
          onClose={() => setDialog(null)}
        >
          <p>
            Our team reviews every request. Your current booster keeps the order until then. If it is approved, a new booster
            takes over and your progress is kept.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Why do you want a different booster? (optional)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--g-accent)]/50"
            />
          </label>
        </ConfirmDialog>
      )}

      {(isBoosterWorking || data.adminCompletion) && (
        <>
          <ConfirmDialog
            open={dialog === "complete"}
            title={viewer.role === "admin" ? "Mark this order as complete?" : "Complete this order"}
            confirmLabel={viewer.role === "admin" ? "Complete order" : "Send for review"}
            busyLabel={viewer.role === "admin" ? "Completing…" : "Uploading…"}
            cancelLabel="Keep working"
            busy={busy === "complete"}
            confirmDisabled={viewer.role !== "admin" && proofs.length === 0}
            error={error}
            onConfirm={() => void complete()}
            onClose={() => setDialog(null)}
          >
            {viewer.role === "admin" ? (
              <p>Only do this once the boost is finished. The customer and the booster are notified.</p>
            ) : (
              <>
                <p>
                  Add 1 to {MAX_PROOFS} screenshots that clearly show the <b>final result</b> (profile or ranked screen). The
                  customer sees them on the order page and an admin checks them, then marks the order Completed.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {previews.map((src, i) => (
                    <div key={src} className="relative aspect-video overflow-hidden rounded-md border border-white/10 bg-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                      <img src={src} alt={`Screenshot ${i + 1}`} className="size-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove screenshot"
                        onClick={() => setProofs((cur) => cur.filter((_, j) => j !== i))}
                        className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white hover:bg-black"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {proofs.length < MAX_PROOFS && (
                    <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[rgba(var(--g-rgb),0.45)] bg-[rgba(var(--g-rgb),0.06)] text-xs text-[var(--g-light)] hover:bg-[rgba(var(--g-rgb),0.12)]">
                      <ImagePlus className="size-5" />
                      Add screenshot
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          addProofs(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-400">Note for the customer (optional)</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                  />
                </label>
                <p className="text-xs text-zinc-500">After sending, stop playing on the account. Your login access ends.</p>
              </>
            )}
          </ConfirmDialog>

          <ConfirmDialog
            open={dialog === "abandon"}
            title={inGrace ? "Release this order?" : "Abandon this order?"}
            confirmLabel={inGrace ? "Release order" : "Abandon order"}
            busyLabel={inGrace ? "Releasing…" : "Abandoning…"}
            cancelLabel="Keep the order"
            tone="danger"
            busy={busy === "abandon"}
            confirmDisabled={!inGrace && reason.trim().length < 3}
            error={error}
            onConfirm={() => void abandon()}
            onClose={() => setDialog(null)}
          >
            {inGrace ? (
              <p>
                Free release until {new Date(data.releaseGraceUntil!).toLocaleTimeString()}: no strike, and the order goes
                straight back to the pool.
              </p>
            ) : (
              <p>
                The order is taken from you and reviewed by an admin before
                another booster can take it. You receive a strike. This cannot be undone.
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">
                {inGrace ? "Reason (optional)" : "Reason (required)"}
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                maxLength={500}
                rows={3}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-rose-400/50"
              />
            </label>
          </ConfirmDialog>
        </>
      )}

    </>
  );
}
