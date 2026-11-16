"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small modal confirmation built on the native <dialog> element (focus trap,
 * Escape and inert background come from the browser). Opening it never
 * changes the workspace layout, which matters in the fixed-height view.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  tone = "gold",
  busy = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  tone?: "gold" | "danger" | "amber";
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      // Land on the safe choice.
      cancelRef.current?.focus();
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  const confirmClass = {
    gold: "bg-[var(--g-accent)] text-[#0A0E14] hover:bg-[var(--g-hover)]",
    danger: "bg-rose-500 text-white hover:bg-rose-400",
    amber: "bg-amber-400 text-[#0A0E14] hover:bg-amber-300",
  }[tone];

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        // Backdrop click closes (the dialog element itself is the backdrop).
        if (e.target === ref.current && !busy) onClose();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-white/10 bg-[#13151d] p-0 text-white shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      <form
        method="dialog"
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !confirmDisabled) onConfirm();
        }}
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        {children && <div className="mt-2 space-y-3 text-sm text-zinc-400">{children}</div>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy || confirmDisabled}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-60",
              confirmClass
            )}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
