import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getFineSchedule, STRIKE_LABEL, strikeSummary } from "@/lib/boosters/discipline";
import { formatMoney } from "@/lib/money";
import { AppealForm } from "@/components/discipline/DisciplineControls";

export const dynamic = "force-dynamic";

const card = "space-y-3 rounded-xl border border-white/10 bg-white/5 p-5";
const STATUS: Record<string, string> = { ISSUED: "Issued", APPEALED: "Appeal pending", UPHELD: "Appeal rejected", REVERSED: "Refunded" };

/** Booster: the published fine schedule, their strikes and fines (with appeals). */
export default async function BoosterRulesPage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "BOOSTER") redirect("/dashboard");

  const [schedule, strikes, fines] = await Promise.all([
    getFineSchedule(),
    strikeSummary(ctx.user.id),
    prisma.boosterFine.findMany({ where: { boosterId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Rules and fines</h1>
        <p className="mt-1 text-sm text-zinc-400">What can lead to a fine, and your strikes and fines.</p>
      </div>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">Fine schedule</h2>
        <p className="text-xs text-zinc-400">
          Fines are issued by our team, never automatically, and are taken off your next payout. You can appeal each fine once.
          Releasing an order within the first minutes (before starting) is free; later it gives a strike.
        </p>
        <ul className="divide-y divide-white/5 text-sm">
          {schedule.map((r) => (
            <li key={r.code} className="flex justify-between gap-4 py-2">
              <span className="text-zinc-200">{r.label}</span>
              <span className="text-zinc-400">{r.amount > 0 ? `up to about ${formatMoney(r.amount, "EUR")}` : "set by our team"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">
          Strikes <span className="font-normal text-zinc-400">· {strikes.last30Days} in the last 30 days</span>
        </h2>
        {strikes.strikes.length === 0 ? (
          <p className="text-sm text-zinc-500">No strikes.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {strikes.strikes.map((s) => (
              <li key={s.id} className={s.removedAt ? "text-zinc-600 line-through" : "text-zinc-300"}>
                {s.createdAt.toISOString().slice(0, 10)} · {STRIKE_LABEL[s.code] ?? s.code}
                {s.note ? ` · ${s.note}` : ""}
                {s.orderId ? ` · order #${s.orderId.slice(-8).toUpperCase()}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">Fines</h2>
        {fines.length === 0 ? (
          <p className="text-sm text-zinc-500">No fines.</p>
        ) : (
          <ul className="space-y-3">
            {fines.map((f) => (
              <li key={f.id} className="space-y-2 rounded-lg bg-black/20 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{formatMoney(f.amount, f.currency)}</span>
                  <span className="text-zinc-400">{schedule.find((r) => r.code === f.code)?.label ?? f.code}</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-zinc-300">{STATUS[f.status] ?? f.status}</span>
                  <span className="text-xs text-zinc-500">
                    {f.createdAt.toISOString().slice(0, 10)} · order #{f.orderId.slice(-8).toUpperCase()}
                    {f.deductedPayoutId ? " · taken off a payout" : ""}
                  </span>
                </div>
                <p className="text-zinc-300">{f.note}</p>
                {f.decisionNote ? <p className="text-xs text-zinc-400">Decision: {f.decisionNote}</p> : null}
                {f.status === "ISSUED" && !f.appealedAt ? <AppealForm fineId={f.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
