import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getGame } from "@/lib/catalog/games";
import { getServiceTemplate } from "@/lib/catalog/service-templates";
import { proofUrl } from "@/lib/orders/completion-request.service";
import { CompletionDecision } from "@/components/admin/CompletionDecision";

export const dynamic = "force-dynamic";

const utc = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * Admin: completions with proof. Disputed ones need a decision; pending ones
 * confirm themselves (or the customer confirms) and are listed for awareness.
 */
export default async function AdminCompletionsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const requests = await prisma.orderCompletionRequest.findMany({
    where: { status: { in: ["DISPUTED", "PENDING"] } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      proofs: { select: { id: true }, orderBy: { createdAt: "asc" } },
      order: { select: { id: true, gameSlug: true, serviceSlug: true, user: { select: { name: true } } } },
    },
  });
  const boosters = await prisma.user.findMany({
    where: { id: { in: [...new Set(requests.map((r) => r.boosterId))] } },
    select: { id: true, name: true },
  });
  const boosterName = new Map(boosters.map((b) => [b.id, b.name ?? "Booster"]));
  const disputed = requests.filter((r) => r.status === "DISPUTED");
  const pending = requests.filter((r) => r.status === "PENDING");

  const Card = ({ r }: { r: (typeof requests)[number] }) => (
    <section className={`space-y-3 rounded-lg border p-4 ${r.status === "DISPUTED" ? "border-amber-400/30 bg-amber-500/[0.06]" : "border-white/10 bg-white/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={`/dashboard/${r.order.id}`} className="font-semibold hover:underline">
            {getGame(r.order.gameSlug)?.name ?? r.order.gameSlug} · {getServiceTemplate(r.order.serviceSlug)?.title ?? r.order.serviceSlug} · #
            {r.order.id.slice(-8).toUpperCase()}
          </Link>
          <p className="text-xs text-zinc-400">
            Booster {boosterName.get(r.boosterId) ?? "—"} · customer {r.order.user.name ?? "—"} · submitted {utc(r.createdAt)}
            {r.status === "PENDING" ? ` · auto-confirms ${utc(r.autoConfirmAt)}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "DISPUTED" ? "bg-amber-400/20 text-amber-200" : "bg-white/10 text-zinc-300"}`}>
          {r.status === "DISPUTED" ? "Disputed" : "Waiting for customer"}
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
      {r.boosterNote ? <p className="text-sm text-zinc-300"><span className="text-zinc-500">Booster: </span>{r.boosterNote}</p> : null}
      {r.disputeReason ? <p className="text-sm text-amber-100"><span className="text-amber-300/80">Customer ({r.disputedAt ? utc(r.disputedAt) : ""}): </span>{r.disputeReason}</p> : null}
      <CompletionDecision requestId={r.id} />
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Completion review</h1>
        <p className="text-sm text-zinc-400">
          Boosters complete orders with screenshots of the final rank. The customer confirms, or the order confirms itself after the
          waiting time. When a customer reports a problem, decide here: complete the order or send it back to the booster.
        </p>
      </div>
      <h2 className="text-lg font-semibold">Disputed ({disputed.length})</h2>
      {disputed.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">Nothing to review.</p>
      ) : (
        disputed.map((r) => <Card key={r.id} r={r} />)
      )}
      <h2 className="text-lg font-semibold">Waiting for the customer ({pending.length})</h2>
      {pending.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">None.</p>
      ) : (
        pending.map((r) => <Card key={r.id} r={r} />)
      )}
    </div>
  );
}
