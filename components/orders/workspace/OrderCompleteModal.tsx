"use client";

import { useEffect, useRef, useState } from "react";
import { PartyPopper, X } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { CashbackEarned, ReviewForm, TipForm } from "./FeedbackPanel";

/**
 * Customer, completed order (client 2026-11-24): "Your order is complete"
 * with the cashback earned, a review and a tip. Opens on each visit until
 * the customer leaves a review; "Later" closes it for this visit only. The
 * same review, tip and cashback stay in the order's "Review and tip" panel.
 */
export function OrderCompleteModal({ data }: { data: WorkspaceDTO }) {
  const f = data.feedback;
  const eligible = data.viewer.role === "customer" && data.order.status === "COMPLETED" && f.canReview;
  // Closed by the customer for this visit; gone for good once reviewed (eligible turns false).
  const [dismissed, setDismissed] = useState(false);
  const open = eligible && !dismissed;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  if (!eligible) return null;
  const close = () => setDismissed(true);

  return (
    <dialog
      ref={ref}
      aria-labelledby="order-complete-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-white/10 bg-[#13151d] p-0 text-white shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      <div className="relative space-y-4 p-5 text-sm">
        <button type="button" onClick={close} aria-label="Close" className="absolute end-3 top-3 rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-white">
          <X className="size-4" />
        </button>
        <div className="flex items-center gap-3 pe-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--g-accent)]/15 text-[var(--g-accent)]">
            <PartyPopper className="size-5" />
          </span>
          <div>
            <h2 id="order-complete-title" className="text-base font-semibold">
              Your order is complete
            </h2>
            <p className="text-xs text-zinc-400">Order #{data.order.id.slice(-8).toUpperCase()}. Thanks for trusting us.</p>
          </div>
        </div>

        <CashbackEarned data={data} />
        <ReviewForm data={data} large onDone={close} />
        {f.canTip ? (
          <div className="border-t border-white/10 pt-4">
            <TipForm data={data} />
          </div>
        ) : null}
        <div className="flex justify-end">
          <button type="button" onClick={close} className="rounded-lg border border-white/10 px-3.5 py-2 text-xs text-zinc-300 hover:bg-white/5">
            Later
          </button>
        </div>
      </div>
    </dialog>
  );
}
