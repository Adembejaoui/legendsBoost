import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { liveOrdersBoard, type BoardTone } from "@/lib/admin/directory";
import { getGame } from "@/lib/catalog/games";
import { AutoRefresh } from "@/components/admin/Phase9Controls";

export const dynamic = "force-dynamic";

const TONE: Record<BoardTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/5",
  warn: "border-amber-400/40 bg-amber-400/10",
  alert: "border-rose-500/50 bg-rose-500/10",
  idle: "border-white/10 bg-white/5",
};
const COLUMNS = [
  { status: "PENDING", title: "Waiting in the pool", hint: "amber after 30 min, red after 2 h" },
  { status: "CLAIMED", title: "Taken, not started", hint: "amber after 30 min, red after 60 min" },
  { status: "IN_PROGRESS", title: "Processing", hint: "red when inactive (no games or messages)" },
  { status: "PAUSED", title: "Paused by the customer", hint: "" },
];

function age(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} days`;
}

/** Admin: active orders by state, coloured by how long they have been waiting. Refreshes every 30 s. */
export default async function AdminLiveBoardPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const rows = await liveOrdersBoard();

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 text-white">
      <AutoRefresh seconds={30} />
      <div>
        <h1 className="text-2xl font-semibold">Live orders</h1>
        <p className="text-sm text-zinc-400">Paid orders that are not finished. Updates every 30 seconds.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => {
          const items = rows.filter((r) => r.status === c.status);
          return (
            <section key={c.status} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {c.title} <span className="text-zinc-500">({items.length})</span>
              </h2>
              {c.hint ? <p className="text-[11px] text-zinc-500">{c.hint}</p> : null}
              {items.length === 0 ? <p className="text-xs text-zinc-600">None.</p> : null}
              {items.map((o) => (
                <Link key={o.id} href={`/dashboard/${o.id}`} className={`block rounded-lg border p-3 text-xs transition hover:border-white/40 ${TONE[o.tone]}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-zinc-300">#{o.id.slice(-8).toUpperCase()}</span>
                    <span className="font-semibold">{age(o.minutes)}</span>
                  </div>
                  <div className="mt-1 text-zinc-300">
                    {getGame(o.gameSlug)?.name ?? o.gameSlug} · {o.serviceSlug}
                    {o.isPriority ? <span className="ms-1 text-[#e3c98f]">priority</span> : null}
                  </div>
                  <div className="mt-1 text-zinc-500">
                    {o.customer ?? "Customer"}
                    {o.booster ? ` → ${o.booster}` : ""} · {o.note}
                  </div>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
