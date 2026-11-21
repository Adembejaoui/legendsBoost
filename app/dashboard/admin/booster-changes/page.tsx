import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getGame } from "@/lib/catalog/games";
import { BoosterChangeDecision } from "@/components/admin/BoosterChangeDecision";

export const dynamic = "force-dynamic";

/** Admin: customers asking for a different booster (oldest first). */
export default async function AdminBoosterChangesPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const requests = await prisma.orderBoosterChangeRequest.findMany({
    where: { status: "REQUESTED" },
    orderBy: { createdAt: "asc" },
    include: { order: { select: { id: true, status: true, gameSlug: true, serviceSlug: true, user: { select: { name: true } } } } },
  });
  const boosters = await prisma.user.findMany({
    where: { id: { in: requests.map((r) => r.boosterId) } },
    select: { id: true, name: true, email: true },
  });
  const boosterName = (id: string) => {
    const b = boosters.find((x) => x.id === id);
    return b?.name ?? b?.email ?? "Booster";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Booster change requests</h1>
        <p className="text-sm text-zinc-400">
          The booster keeps the order until you decide. Approving removes the booster and puts the order back on the marketplace;
          the removed booster can never take it again. Rejecting keeps everything as it is and shows your note to the customer.
        </p>
      </div>
      {requests.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">No open requests.</p>
      ) : (
        requests.map((r) => (
          <section key={r.id} className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
            <div>
              <Link href={`/dashboard/${r.order.id}`} className="font-semibold hover:underline">
                {getGame(r.order.gameSlug)?.name ?? r.order.gameSlug} · {r.order.serviceSlug} · #{r.order.id.slice(-8).toUpperCase()}
              </Link>
              <p className="text-xs text-zinc-400">
                {r.order.user.name ?? "Customer"} · booster {boosterName(r.boosterId)} · requested{" "}
                {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · order {r.order.status}
              </p>
            </div>
            <p className="whitespace-pre-wrap rounded-md bg-black/20 p-3 text-sm text-zinc-200">{r.reason}</p>
            <BoosterChangeDecision requestId={r.id} />
          </section>
        ))
      )}
    </div>
  );
}
