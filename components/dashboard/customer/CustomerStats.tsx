import { Trophy, Gamepad2, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: "default" | "active" | "completed" | "neutral";
  accent?: boolean;
}

const statConfig: Record<StatCardProps["color"], { bg: string; border: string; text: string }> = {
  default: { bg: "bg-white/5", border: "border-white/10", text: "text-zinc-400" },
  active: { bg: "bg-violet-500/10", border: "border-violet-500/30", text: "text-violet-400" },
  completed: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400" },
  neutral: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400" },
};

export function CustomerStatCard({ label, value, icon: Icon, color, accent }: StatCardProps) {
  const cfg = statConfig[color];
  return (
    <div className={cn("rounded-xl border p-5", cfg.bg, cfg.border, accent ? "ring-1 ring-violet-500/50" : "")}>
      <div className="flex items-center justify-between mb-3">
        <div className={cn("rounded-lg p-2.5", cfg.bg.replace("/10", "/20"))}>
          <Icon className={cn("size-5", cfg.text)} />
        </div>
        {accent && <span className="size-1.5 rounded-full bg-violet-500" />}
      </div>
      <div className="text-sm font-medium text-zinc-400">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

export function CustomerStats({ total, active, completed }: { total: number; active: number; completed: number }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <CustomerStatCard
        label="Total orders"
        value={total}
        icon={Gamepad2}
        color="neutral"
      />
      <CustomerStatCard
        label="Active orders"
        value={active}
        icon={Clock}
        color="active"
        accent
      />
      <CustomerStatCard
        label="Completed orders"
        value={completed}
        icon={CheckCircle2}
        color="completed"
      />
    </section>
  );
}
