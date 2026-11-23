import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { boosterDirectory } from "@/lib/admin/directory";
import { BOOSTER_STATUS_LABEL, type BoosterStatus } from "@/lib/boosters/status";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const th = "px-2 py-1.5 text-left text-xs font-medium text-zinc-400";
const td = "px-2 py-1.5";
const STATUSES = ["APPROVED", "TRIAL", "ON_BREAK", "PENDING", "UNDER_REVIEW", "NEEDS_INFO", "SUSPENDED", "REJECTED", "TERMINATED"];

/** Admin: every booster with status, work, rating and discipline at a glance. */
export default async function AdminBoostersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const { status } = await searchParams;
  const boosters = await boosterDirectory({ status: status && STATUSES.includes(status) ? status : undefined });

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 text-white">
      <h1 className="text-2xl font-semibold">Boosters</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/dashboard/admin/boosters" className={`rounded-full px-3 py-1 ${!status ? "bg-white/15" : "bg-white/5 text-zinc-400"}`}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/dashboard/admin/boosters?status=${s}`} className={`rounded-full px-3 py-1 ${status === s ? "bg-white/15" : "bg-white/5 text-zinc-400"}`}>
            {BOOSTER_STATUS_LABEL[s as BoosterStatus] ?? s}
          </Link>
        ))}
      </div>
      {boosters.length === 0 ? (
        <p className="text-sm text-zinc-500">No boosters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Booster</th>
                <th className={th}>Status</th>
                <th className={th}>Identity</th>
                <th className={th}>Games</th>
                <th className={th}>Active</th>
                <th className={th}>Completed</th>
                <th className={th}>Rating</th>
                <th className={th}>Strikes 30d</th>
                <th className={th}>Fines due</th>
              </tr>
            </thead>
            <tbody>
              {boosters.map((b) => (
                <tr key={b.id} className="border-t border-white/5">
                  <td className={td}>
                    <Link href={`/dashboard/admin/boosters/${b.id}`} className="text-violet-300 hover:underline">
                      {b.name ?? b.email}
                    </Link>
                    {b.displayName ? <div className="text-xs text-zinc-500">public: {b.displayName}</div> : null}
                  </td>
                  <td className={td}>
                    {BOOSTER_STATUS_LABEL[b.status as BoosterStatus] ?? b.status}
                    {b.status === "TRIAL" ? <span className="text-xs text-zinc-500"> · {b.trialOrdersRemaining ?? 0} left</span> : null}
                  </td>
                  <td className={td}>{b.kycStatus.replace("_", " ").toLowerCase()}</td>
                  <td className={td}>{b.games}</td>
                  <td className={td}>
                    {b.active}
                    {b.limit ? <span className="text-xs text-zinc-500"> / {b.limit}</span> : null}
                  </td>
                  <td className={td}>{b.completed}</td>
                  <td className={td}>{b.rating !== null ? `★ ${b.rating.toFixed(1)} (${b.reviews})` : "—"}</td>
                  <td className={`${td} ${b.strikes30d >= 3 ? "text-rose-300" : ""}`}>{b.strikes30d}</td>
                  <td className={td}>{b.finesDue > 0 ? formatMoney(b.finesDue, "EUR") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
