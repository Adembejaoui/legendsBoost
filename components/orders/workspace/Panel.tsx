"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  icon,
  action,
  children,
  className = "",
  bodyClassName = "",
  dense = false,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Compact header/body padding for the fixed-height workspace. */
  dense?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-xl border border-white/[0.07] bg-[#11131a] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]",
        className
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06]",
          dense ? "px-3 py-2" : "px-4 py-3"
        )}
      >
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          {icon ? <span className="text-[var(--g-accent)]">{icon}</span> : null}
          {title}
        </h2>
        {action}
      </header>
      <div className={cn(dense ? "p-3" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-zinc-100", mono && "font-mono text-[13px]")}>{value}</dd>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "gold" | "green" | "red" | "amber" | "violet" | "blue";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-white/10 bg-white/[0.04] text-zinc-300",
    gold: "border-[var(--g-accent)]/30 bg-[var(--g-accent)]/10 text-[var(--g-light)]",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    red: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    blue: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export const ORDER_STATUS_TONE: Record<string, "neutral" | "gold" | "green" | "red" | "amber" | "violet" | "blue"> = {
  PENDING: "blue",
  CLAIMED: "violet",
  IN_PROGRESS: "gold",
  PAUSED: "amber",
  COMPLETED: "green",
  CANCELLED: "red",
  DRAFT: "violet",
};

/** <img> with an initials fallback (external CDN art may be unavailable). */
export function GameArt({
  src,
  alt,
  fallback,
  className,
}: {
  src: string | null;
  alt: string;
  fallback: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return (
      <span
        aria-hidden={alt === "" ? true : undefined}
        className={cn(
          "grid place-items-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-[10px] font-bold uppercase text-zinc-300",
          className
        )}
      >
        {fallback.slice(0, 2)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={cn("object-cover", className)} onError={() => setFailed(true)} loading="lazy" />;
}

/**
 * A Panel, or (embedded) a plain sub-section with the same title/action, used
 * when several blocks are grouped inside one parent Panel.
 */
export function PanelOrSection({
  embedded = false,
  title,
  icon,
  action,
  children,
  dense = false,
}: {
  embedded?: boolean;
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  dense?: boolean;
}) {
  if (!embedded) {
    return (
      <Panel dense={dense} title={title} icon={icon} action={action}>
        {children}
      </Panel>
    );
  }
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {icon ? <span className="text-[var(--g-accent)]">{icon}</span> : null}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
