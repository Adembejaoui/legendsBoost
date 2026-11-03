import { Clock, CheckCircle2, XCircle, Package, Gamepad2, ArrowRight } from "lucide-react";
import Link from "next/link";

const EMPTY_STATE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; title: string; description: string; ctaLabel: string; ctaHref: string }> = {
  default: {
    icon: Package,
    title: "You have no orders yet",
    description: "Pick a game and service to place your first order.",
    ctaLabel: "Browse games",
    ctaHref: "/games",
  },
  filtered: {
    icon: Gamepad2,
    title: "No orders found",
    description: "Try a different status filter or clear the current one.",
    ctaLabel: "Clear filter",
    ctaHref: "/dashboard/customer",
  },
};

interface CustomerEmptyStateProps {
  variant?: "default" | "filtered";
}

export function CustomerEmptyState({ variant = "default" }: CustomerEmptyStateProps) {
  const cfg = EMPTY_STATE_CONFIG[variant];
  return (
    <section className="rounded-xl border border-dashed border-white/15 bg-white/5 p-12 text-center">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-white/5 mb-4">
        <cfg.icon className="size-6 text-zinc-500" />
      </div>
      <h2 className="text-lg font-semibold text-white">{cfg.title}</h2>
      <p className="mt-2 text-sm text-zinc-400">{cfg.description}</p>
      <Link
        href={cfg.ctaHref}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {cfg.ctaLabel} <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}
