import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getBoosterAssignments } from "@/lib/assignments/service";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";
import { poolChannel } from "@/lib/realtime/channel-names";
import { devLogRedirect } from "@/lib/dashboard/role-routing";
import { hasBoosterAccess } from "@/lib/boosters/status";
import { boosterBalances } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/money";
import { Clock, Snowflake, Wallet } from "lucide-react";

/** "€12.50" or "€12.50 · $3.00"; zero in EUR when empty. */
function money(m: Record<string, number>): string {
  const parts = Object.entries(m).filter(([, v]) => v !== 0).map(([cur, v]) => formatMoney(v, cur));
  return parts.length ? parts.join(" · ") : formatMoney(0, "EUR");
}

type BoosterAccountStatusProps = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: string;
  };
  boosterProfile: {
    id: string;
    userId: string;
    verificationStatus: string;
    availabilityStatus: string;
  } | null;
};

function BoosterAccountStatus({ user, boosterProfile }: BoosterAccountStatusProps) {
  const status = boosterProfile?.verificationStatus ?? "MISSING";
  const reasons: Record<string, string> = {
    MISSING: "No booster profile exists for this account.",
    PENDING: "Your booster application is pending review.",
    REJECTED: "Your booster application was rejected.",
    SUSPENDED: "Your booster account is suspended.",
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Booster account status</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Your booster account cannot access the booster dashboard yet.
      </p>
      <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="text-sm text-zinc-400">Account</div>
        <div className="mt-1 text-sm text-white">{user.name || user.email}</div>
        <div className="mt-1 text-sm text-white">{user.role}</div>
        <div className="mt-4 text-sm text-zinc-400">Verification status</div>
        <div className="mt-1 text-sm font-medium text-white">{status}</div>
        <div className="mt-3 text-sm text-zinc-400">{reasons[status] ?? reasons.MISSING}</div>
      </div>
      <div className="mt-6">
        <Link
          href="/dashboard/customer"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
        >
          Continue to customer dashboard
        </Link>
      </div>
    </div>
  );
}

export default async function BoosterDashboardPage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  const { user, boosterProfile } = ctx;
  const boosterStatus = boosterProfile?.verificationStatus ?? null;

  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect("/dashboard/admin");
  }
  if (user.role === "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/booster",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role !== "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/booster",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for booster dashboard",
    });
    redirect("/login");
  }

  if (!boosterProfile || !hasBoosterAccess(boosterProfile.verificationStatus)) {
    console.info("[DASHBOARD_AUTH]", {
      from: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Booster profile missing, pending, rejected or suspended; rendering account-status page instead of redirecting",
    });
    return <BoosterAccountStatus user={user} boosterProfile={boosterProfile} />;
  }

  const [availableOrders, assignments, balances] = await Promise.all([
    (async () => {
      // Same list the booster sees: only orders within their ceilings.
      const { getPoolForBooster } = await import("@/lib/pool/service");
      return (await getPoolForBooster(user.id)).orders.length;
    })(),
    getBoosterAssignments(user.id, "all"),
    boosterBalances(user.id),
  ]);

  const claimed = assignments.length;
  const inProgress = assignments.filter((a: any) => a.status === "IN_PROGRESS").length;
  const completed = assignments.filter((a: any) => a.status === "COMPLETED").length;

  return (
    <div>
      <LiveRefresh subscriptions={[{ channel: poolChannel(), events: ["pool.changed"] }]} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Welcome back, {user.name || "Booster"}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Verification: {boosterProfile.verificationStatus} • Availability: {boosterProfile.availabilityStatus}
        </p>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Link
          href="/dashboard/booster/cashout"
          className="group rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/[0.12] to-emerald-500/[0.03] p-4 transition-colors hover:border-emerald-400/45"
        >
          <div className="flex items-center gap-2 text-sm text-emerald-200/80">
            <Wallet className="size-4 text-emerald-300" /> Balance
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{money(balances.available)}</div>
          {Object.keys(balances.finesDue).length > 0 ? (
            <div className="mt-1 text-xs text-rose-300/80">After {money(balances.finesDue)} in unpaid fines</div>
          ) : null}
          <div className="mt-1 text-xs text-emerald-200/60 group-hover:text-emerald-200">Ready to cash out →</div>
        </Link>
        <div className="rounded-xl border border-sky-400/25 bg-gradient-to-br from-sky-500/[0.12] to-sky-500/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm text-sky-200/80">
            <Snowflake className="size-4 text-sky-300" /> Frozen balance
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{money(balances.frozen)}</div>
          <div className="mt-1 text-xs text-sky-200/60">Payout of your claimed orders · released when an admin marks them Completed</div>
        </div>
        <div className="rounded-xl border border-amber-400/25 bg-gradient-to-br from-amber-500/[0.12] to-amber-500/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm text-amber-200/80">
            <Clock className="size-4 text-amber-300" /> Waiting for review
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{balances.waitingForReview}</div>
          <div className="mt-1 text-xs text-amber-200/60">
            Order{balances.waitingForReview === 1 ? "" : "s"} sent with screenshots · an admin marks {balances.waitingForReview === 1 ? "it" : "them"} Completed
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-4">
          <div className="text-sm text-zinc-400">Available Orders</div>
          <div className="mt-1 text-2xl font-bold text-white">{availableOrders}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-4">
          <div className="text-sm text-zinc-400">Claimed Orders</div>
          <div className="mt-1 text-2xl font-bold text-white">{claimed}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-4">
          <div className="text-sm text-zinc-400">Processing</div>
          <div className="mt-1 text-2xl font-bold text-violet-400">{inProgress}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-4">
          <div className="text-sm text-zinc-400">Completed Assignments</div>
          <div className="mt-1 text-2xl font-bold text-green-400">{completed}</div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Quick Navigation</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/booster/available-orders" className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600">
            Browse Available Orders
          </Link>
          <Link href="/dashboard/booster/claimed-orders" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">
            My Claimed Orders
          </Link>
          <Link href="/dashboard/booster/profile" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">
            My Profile
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Recent Activity</h2>
        <div className="space-y-2">
          {assignments.slice(0, 5).map((assignment: any) => (
            <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-white/5 p-3">
              <div>
                <div className="text-sm text-white">Order #{assignment.orderId.slice(-8).toUpperCase()}</div>
                <div className="text-xs text-zinc-400">{assignment.status}</div>
              </div>
              <div className="text-xs text-zinc-400">
                {new Date(assignment.assignedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
          {assignments.length === 0 && (
            <p className="text-center text-sm text-zinc-400">No recent activity</p>
          )}
        </div>
      </div>
    </div>
  );
}
