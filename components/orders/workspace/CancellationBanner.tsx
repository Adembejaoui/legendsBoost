"use client";

import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { formatMoney } from "@/lib/money";

/** Status of the customer's cancellation request (customer and admin views). */
export function CancellationBanner({ data }: { data: WorkspaceDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = data.cancellation.latest;
  if (!r || r.status === "WITHDRAWN") return null;
  const isCustomer = data.viewer.role === "customer";
  const isAdmin = data.viewer.role === "admin";
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
  const money = (n: number | null) => (n !== null && data.order.currency ? formatMoney(n, data.order.currency) : null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${data.order.id}/cancellation-request`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not withdraw the request");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw the request");
    } finally {
      setBusy(false);
    }
  }

  if (r.status === "REQUESTED") {
    return (
      <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-rose-400/30 bg-rose-400/[0.07] px-3 py-2">
        <p className="min-w-0 flex-1 text-[13px] text-rose-100">
          <span className="font-semibold">Cancellation requested</span>{" "}
          <span className="text-rose-100/80">
            on {when(r.createdAt)}.{" "}
            {isCustomer ? "Our team is reviewing it; work continues until then (you can pause the order)." : `Reason: ${r.reason}`}
          </span>
        </p>
        {isCustomer ? (
          <button
            type="button"
            onClick={() => void withdraw()}
            disabled={busy}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-50"
          >
            Withdraw request
          </button>
        ) : null}
        {isAdmin ? (
          <Link href="/dashboard/admin/cancellations" className="rounded-lg bg-[var(--g-accent)] px-3 py-1.5 text-xs font-semibold text-[#0A0E14]">
            Review
          </Link>
        ) : null}
        {error ? <p role="alert" className="w-full text-xs text-rose-300">{error}</p> : null}
      </div>
    );
  }

  if (r.status === "REJECTED") {
    return (
      <div className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-zinc-300">
        <span className="font-semibold">Cancellation request declined</span> ({when(r.decidedAt)}).{" "}
        {r.adminNote ? <span className="text-zinc-400">{r.adminNote}</span> : null}
      </div>
    );
  }

  // APPROVED
  return (
    <div className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-zinc-300">
      <span className="font-semibold">Cancelled at your request</span> ({when(r.decidedAt)}).{" "}
      {r.refundAmount ? `Refund: ${money(r.refundAmount)} (it can take 5-10 days to appear).` : "No refund was due."}
      {r.adminNote ? <span className="text-zinc-400"> {r.adminNote}</span> : null}
    </div>
  );
}
