import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { formatMoney } from "@/lib/money";
import { getGame } from "@/lib/catalog/games";
import { CancellationDecision } from "@/components/admin/CancellationDecision";

export const dynamic = "force-dynamic";

/** Admin: customer cancellation requests waiting for a decision (oldest first). */
export default async function AdminCancellationsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const requests = await prisma.orderCancellationRequest.findMany({
    where: { status: "REQUESTED" },
    orderBy: { createdAt: "asc" },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          gameSlug: true,
          serviceSlug: true,
          user: { select: { name: true } },
          pricingSnapshot: { select: { totalAmount: true, currency: true } },
          assignments: { select: { startedAt: true, status: true } },
          _count: { select: { matches: true } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Cancellation requests</h1>
        <p className="text-sm text-zinc-400">
          Customers cannot cancel on their own. Approving cancels the order (the booster loses access) and refunds the amount you
          set: the full price if no work started, otherwise the part not yet done (open the order to see the progress).
        </p>
      </div>
      {requests.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">No open requests.</p>
      ) : (
        requests.map((r) => {
          const snap = r.order.pricingSnapshot;
          const started = r.order.assignments.some((a) => a.startedAt) || r.order._count.matches > 0;
          return (
            <section key={r.id} className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/dashboard/${r.order.id}`} className="font-semibold hover:underline">
                    {getGame(r.order.gameSlug)?.name ?? r.order.gameSlug} · {r.order.serviceSlug} · #{r.order.id.slice(-8).toUpperCase()}
                  </Link>
                  <p className="text-xs text-zinc-400">
                    {r.order.user.name ?? "Customer"} · requested {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · order{" "}
                    {r.order.status}
                    {started ? " · work started" : " · no work started"}
                  </p>
                </div>
                <div className="text-end text-sm">
                  <p className="text-zinc-400">Paid</p>
                  <p className="font-semibold">{snap ? formatMoney(snap.totalAmount, snap.currency) : "—"}</p>
                </div>
              </div>
              <p className="whitespace-pre-wrap rounded-md bg-black/20 p-3 text-sm text-zinc-200">{r.reason}</p>
              {snap ? (
                <CancellationDecision
                  requestId={r.id}
                  paid={snap.totalAmount}
                  currency={snap.currency}
                  suggestedRefund={started ? null : snap.totalAmount}
                />
              ) : (
                <p className="text-xs text-amber-300">This order has no price snapshot; refund it manually from the finance tools.</p>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
