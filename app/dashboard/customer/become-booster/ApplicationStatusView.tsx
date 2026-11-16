import { $Enums } from "@/app/generated/prisma/client";

export function ApplicationStatusView({
  status,
  rejectionReason,
  reviewNote,
  canReapply,
}: {
  status: $Enums.BoosterVerificationStatus;
  rejectionReason: string | null;
  reviewNote?: string | null;
  canReapply: boolean;
}) {
  const labels: Record<string, { label: string; color: "violet" | "rose" | "emerald" }> = {
    PENDING: { label: "Application submitted", color: "violet" },
    UNDER_REVIEW: { label: "Application under review", color: "violet" },
    NEEDS_INFO: { label: "More information needed", color: "rose" },
    REJECTED: { label: "Application rejected", color: "rose" },
  };

  const config = labels[status] ?? labels.PENDING;
  const colorClasses: Record<string, string> = {
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClasses[config.color]}`}>
          {status}
        </span>
        <span className="text-sm font-medium text-white">{config.label}</span>
      </div>

      {status === "NEEDS_INFO" && (
        <div className="mt-2 text-sm text-zinc-300">
          <span className="font-semibold">Our team asks: </span>
          {reviewNote ?? "Please complete your application."}
          <p className="mt-2 text-zinc-400">Update the form below and submit it again.</p>
        </div>
      )}

      {(status === "PENDING" || status === "UNDER_REVIEW") && (
        <p className="mt-2 text-sm text-zinc-400">
          Your application is pending review by our admin team. You remain a CUSTOMER until your
          application is approved. You can continue placing orders in the meantime.
        </p>
      )}

      {status === "REJECTED" && rejectionReason && (
        <div className="mt-2 text-sm text-zinc-400">
          <span className="font-semibold">Reason: </span>
          {rejectionReason}
        </div>
      )}

      {canReapply && (
        <p className="mt-3 text-sm text-zinc-400">
          You may submit a new application at any time.
        </p>
      )}
    </section>
  );
}
