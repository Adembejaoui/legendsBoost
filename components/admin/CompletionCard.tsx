import Link from "next/link";
import { getGame } from "@/lib/catalog/games";
import { getServiceTemplate } from "@/lib/catalog/service-templates";
import { proofUrl } from "@/lib/orders/completion-request.service";
import { CompletionDecision } from "@/components/admin/CompletionDecision";

const utc = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

export interface CompletionCardRequest {
  id: string;
  orderId: string;
  status: string;
  createdAt: Date;
  boosterNote: string | null;
  disputeReason: string | null;
  disputedAt: Date | null;
  proofs: { id: string }[];
  order: { id: string; gameSlug: string; serviceSlug: string; user: { name: string | null } };
}

/**
 * One completion waiting for an admin: the booster's screenshots, notes and
 * the Mark Completed / Send back buttons (admin Completions page and order editor).
 */
export function CompletionCard({ r, boosterName, showTitle = true }: { r: CompletionCardRequest; boosterName: string; showTitle?: boolean }) {
  const disputed = r.status === "DISPUTED";
  return (
    <section className={`space-y-3 rounded-lg border p-4 ${disputed ? "border-amber-400/30 bg-amber-500/[0.06]" : "border-white/10 bg-white/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {showTitle ? (
            <Link href={`/dashboard/admin/orders/${r.order.id}`} className="font-semibold hover:underline">
              {getGame(r.order.gameSlug)?.name ?? r.order.gameSlug} · {getServiceTemplate(r.order.serviceSlug)?.title ?? r.order.serviceSlug} · #
              {r.order.id.slice(-8).toUpperCase()}
            </Link>
          ) : (
            <p className="font-semibold">Completion screenshots</p>
          )}
          <p className="text-xs text-zinc-400">
            Booster {boosterName} · customer {r.order.user.name ?? "—"} · submitted {utc(r.createdAt)}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${disputed ? "bg-amber-400/20 text-amber-200" : "bg-white/10 text-zinc-300"}`}>
          {disputed ? "Problem reported" : "Waiting for review"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {r.proofs.map((p, i) => (
          <a key={p.id} href={proofUrl(r.orderId, p.id)} target="_blank" rel="noopener" className="block h-24 w-40 overflow-hidden rounded-md border border-white/10 bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the app */}
            <img src={proofUrl(r.orderId, p.id)} alt={`Proof ${i + 1}`} loading="lazy" className="size-full object-cover" />
          </a>
        ))}
      </div>
      {r.boosterNote ? (
        <p className="text-sm text-zinc-300">
          <span className="text-zinc-500">Booster: </span>
          {r.boosterNote}
        </p>
      ) : null}
      {r.disputeReason ? (
        <p className="text-sm text-amber-100">
          <span className="text-amber-300/80">Customer ({r.disputedAt ? utc(r.disputedAt) : ""}): </span>
          {r.disputeReason}
        </p>
      ) : null}
      <CompletionDecision requestId={r.id} />
    </section>
  );
}
