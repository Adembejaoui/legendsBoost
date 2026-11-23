import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getFineSchedule, STRIKE_LABEL, strikeSummary } from "@/lib/boosters/discipline";
import { formatMoney, toDecimalString } from "@/lib/money";
import { AppealForm } from "@/components/discipline/DisciplineControls";

export const dynamic = "force-dynamic";

const card = "space-y-3 rounded-xl border border-white/10 bg-white/5 p-5";
const STATUS: Record<string, string> = { ISSUED: "Issued", APPEALED: "Appeal pending", UPHELD: "Appeal rejected", REVERSED: "Refunded" };

/** "10.00 EUR": amount and currency code. */
function code(amount: number, currency: string) {
  try {
    return `${toDecimalString(amount, currency)} ${currency}`;
  } catch {
    return formatMoney(amount, currency);
  }
}

/**
 * Booster: Fines/Abandoned Orders (client PDF 2026-11-23; was "Rules and
 * fines"). One row per deduction (Order ID, Reason, Reduced Amount), then the
 * published fine schedule and strikes. Dropping an order after starting is
 * fined with LATE_RELEASE, so abandoned orders appear here too.
 */
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
        <h1 className="text-2xl font-bold text-white">Fines/Abandoned Orders</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every amount taken off your payments, with the order and the reason. You can appeal each fine once.
        </p>
      </div>

      <section className={card}>
        <h2 className="text-sm font-semibold text-white">Deductions</h2>
        {fines.length === 0 ? (
          <p className="text-sm text-zinc-500">No fines or abandoned orders.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-140 text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-start">Order ID</th>
                  <th className="px-3 py-2 text-start">Reason</th>
                  <th className="px-3 py-2 text-end">Reduced Amount</th>
                </tr>
              </thead>
              <tbody>
                {fines.map((f) => (
                  <tr key={f.id} className="border-t border-white/5 align-top">
                    <td className="px-3 py-2 font-mono text-zinc-200">#{f.orderId.slice(-8).toUpperCase()}</td>
                    <td className="space-y-1.5 px-3 py-2">
                      <p className="font-medium text-zinc-100">{schedule.find((r) => r.code === f.code)?.label ?? f.code}</p>
                      {f.note ? <p className="text-zinc-400">{f.note}</p> : null}
                      <p className="text-xs text-zinc-500">
                        {f.createdAt.toISOString().slice(0, 10)} ·{" "}
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-zinc-300">{STATUS[f.status] ?? f.status}</span>
                        {f.deductedPayoutId ? " · taken off a payout" : ""}
                      </p>
                      {f.decisionNote ? <p className="text-xs text-zinc-400">Decision: {f.decisionNote}</p> : null}
                      {f.status === "ISSUED" && !f.appealedAt ? <AppealForm fineId={f.id} /> : null}
                    </td>
                    <td className={`px-3 py-2 text-end font-semibold tabular-nums ${f.status === "REVERSED" ? "text-zinc-500 line-through" : "text-rose-300"}`}>
                      −{code(f.amount, f.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
              <span className="text-zinc-400">{r.amount > 0 ? `up to about ${code(r.amount, "EUR")}` : "set by our team"}</span>
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
    </div>
  );
}
