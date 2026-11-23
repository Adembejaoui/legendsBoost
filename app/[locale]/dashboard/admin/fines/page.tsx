import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { formatMoney } from "@/lib/money";
import { FineDecision } from "@/components/discipline/DisciplineControls";

export const dynamic = "force-dynamic";

/** Admin: open fine appeals (oldest first) and the latest fines. */
export default async function AdminFinesPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const [appeals, recent] = await Promise.all([
    prisma.boosterFine.findMany({ where: { status: "APPEALED" }, orderBy: { appealedAt: "asc" }, take: 100 }),
    prisma.boosterFine.findMany({ where: { status: { not: "APPEALED" } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const ids = [...new Set([...appeals, ...recent].map((f) => f.boosterId))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const row = (f: (typeof recent)[number], appealed: boolean) => (
    <li key={f.id} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{formatMoney(f.amount, f.currency)}</span>
        <span className="text-zinc-400">{f.code}</span>
        <Link href={`/dashboard/admin/boosters/${f.boosterId}`} className="text-violet-300 hover:underline">
          {names.get(f.boosterId) ?? "Booster"}
        </Link>
        <Link href={`/dashboard/${f.orderId}`} className="text-xs text-zinc-400 hover:underline">
          Order #{f.orderId.slice(-8).toUpperCase()}
        </Link>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs">{f.status.toLowerCase()}</span>
      </div>
      <p className="text-zinc-300">{f.note}</p>
      {f.appealText ? <p className="rounded bg-black/30 p-2 text-zinc-200">Appeal: {f.appealText}</p> : null}
      {f.decisionNote ? <p className="text-xs text-zinc-400">Decision: {f.decisionNote}</p> : null}
      <FineDecision fineId={f.id} appealed={appealed} reversible={!appealed && f.status !== "REVERSED"} />
    </li>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Fines</h1>
        <p className="text-sm text-zinc-400">Issue fines from a booster&apos;s page. Accepting an appeal refunds the fine and removes its strike.</p>
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Appeals to decide ({appeals.length})</h2>
        {appeals.length === 0 ? <p className="text-sm text-zinc-500">No open appeals.</p> : <ul className="space-y-3">{appeals.map((f) => row(f, true))}</ul>}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Latest fines</h2>
        {recent.length === 0 ? <p className="text-sm text-zinc-500">No fines yet.</p> : <ul className="space-y-3">{recent.map((f) => row(f, false))}</ul>}
      </section>
    </div>
  );
}
