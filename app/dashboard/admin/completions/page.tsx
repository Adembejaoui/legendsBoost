import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { CompletionCard } from "@/components/admin/CompletionCard";

export const dynamic = "force-dynamic";

/**
 * Admin: completions with proof. Every one needs an admin (client PDFs
 * 2026-11-22): Mark Completed (the booster's payout becomes available) or
 * send it back. Those where the customer reported a problem come first.
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Completion review</h1>
        <p className="text-sm text-zinc-400">
          Boosters complete orders with screenshots of the result; the customer sees them on the order page. Check them and click
          Mark Completed: the customer sees Completed at once and the booster&apos;s payout becomes available. Or send the order back
          to the booster with a note.
        </p>
      </div>
      <h2 className="text-lg font-semibold">Problem reported by the customer ({disputed.length})</h2>
      {disputed.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">None.</p>
      ) : (
        disputed.map((r) => <CompletionCard key={r.id} r={r} boosterName={boosterName.get(r.boosterId) ?? "—"} />)
      )}
      <h2 className="text-lg font-semibold">Waiting for review ({pending.length})</h2>
      {pending.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">Nothing to review.</p>
      ) : (
        pending.map((r) => <CompletionCard key={r.id} r={r} boosterName={boosterName.get(r.boosterId) ?? "—"} />)
      )}
    </div>
  );
}
