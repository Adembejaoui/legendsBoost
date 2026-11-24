import { Link } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { adminAnalytics, type AnalyticsRange } from "@/lib/admin/analytics";
import { formatMoney } from "@/lib/money";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import { jobProblems } from "@/lib/automation/admin-alerts";

function moneyLine(m: Record<string, number>) {
  const entries = Object.entries(m).filter(([, v]) => v !== 0);
  return entries.length ? entries.map(([c, v]) => formatMoney(v, c)).join(" · ") : formatMoney(0, "EUR");
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/admin",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  if (ctx.user.role === "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/admin",
      to: "/dashboard/customer",
      databaseRole: ctx.user.role,
      boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect(getRoleHomePath(ctx.user.role));
  }
  if (ctx.user.role === "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/admin",
      to: "/dashboard/booster",
      databaseRole: ctx.user.role,
      boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
      reason: "BOOSTER must use the booster dashboard",
    });
    redirect(getRoleHomePath(ctx.user.role));
  }
  if (ctx.user.role !== "ADMIN") {
    devLogRedirect({
      from: "/dashboard/admin",
      to: "/login",
      databaseRole: ctx.user.role,
      boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
      reason: "Unauthorized role for admin dashboard",
    });
    redirect("/login");
  }
  const days: AnalyticsRange = (await searchParams).days === "30" ? 30 : 7;
  const [a, jobs] = await Promise.all([adminAnalytics(days), jobProblems().catch(() => [])]);
  const tiles: [string, string, string?][] = [
    ["Paid orders", String(a.paidOrders)],
    ["Revenue", moneyLine(a.revenue), "what customers paid"],
    ["Platform margin", moneyLine(a.platformMargin), "commission, bid margins, fines, tip commission"],
    ["Owed to boosters", moneyLine(a.owedToBoosters), "earned and not paid out yet (all time)"],
    ["Avg. time until taken", a.avgMinutesToClaim === null ? "—" : `${a.avgMinutesToClaim} min`, "from payment to a booster taking it"],
    ["Completed / cancelled", `${a.completedOrders} / ${a.cancelledOrders}`],
    ["Start warnings", String(a.startWarnings), "orders not started within the limit"],
    ["Inactivity warnings", String(a.inactivityWarnings)],
  ];
  return (
    <div className="space-y-6 text-white">
      {/* Scheduled jobs late or failing (checked on every visit, so it shows even if the alert job stopped). */}
      {jobs.length > 0 ? (
        <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-semibold">Scheduled jobs need attention</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-amber-200/90">
            {jobs.map((j) => (
              <li key={j.job}>
                <span className="font-mono">{j.job}</span>:{" "}
                {j.problem === "late" ? `no run for ${j.minutes} minutes (check cron-job.org)` : `last run failed: ${j.error}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin Overview</h1>
          <p className="mt-1 text-sm text-zinc-400">Last {days} days.</p>
        </div>
        <div className="flex gap-2 text-sm">
          {[7, 30].map((d) => (
            <Link key={d} href={`/dashboard/admin?days=${d}`} className={`rounded-full px-3 py-1 ${days === d ? "bg-white/15" : "bg-white/5 text-zinc-400"}`}>
              {d} days
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-zinc-400">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
            {hint ? <div className="mt-1 text-[11px] text-zinc-500">{hint}</div> : null}
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold">Top boosters ({days} days)</h2>
        {a.topBoosters.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No completed orders in this period.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {a.topBoosters.map((b) => (
              <li key={b.id} className="flex flex-wrap gap-3">
                <Link href={`/dashboard/admin/boosters/${b.id}`} className="text-violet-300 hover:underline">
                  {b.name}
                </Link>
                <span className="text-zinc-400">{b.completed} completed</span>
                <span className="text-zinc-400">{b.rating !== null ? `★ ${b.rating.toFixed(1)}` : "no reviews"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-zinc-500">
        <Link href="/dashboard/admin/live" className="text-violet-300 hover:underline">Live orders</Link> shows what needs attention right now.
      </p>
    </div>
  );
}
