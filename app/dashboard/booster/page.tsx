import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getBoosterAssignments } from "@/lib/assignments/service";
import { devLogRedirect } from "@/lib/dashboard/role-routing";

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
        <a
          href="/dashboard/customer"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
        >
          Continue to customer dashboard
        </a>
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

  if (!boosterProfile || boosterProfile.verificationStatus !== "APPROVED") {
    console.info("[DASHBOARD_AUTH]", {
      from: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Booster profile missing, pending, rejected or suspended; rendering account-status page instead of redirecting",
    });
    return <BoosterAccountStatus user={user} boosterProfile={boosterProfile} />;
  }

  const [availableOrders, assignments] = await Promise.all([
    (async () => {
      const { getAvailableOrders } = await import("@/lib/assignments/service");
      const orders = await getAvailableOrders();
      return orders.length;
    })(),
    getBoosterAssignments(user.id, "all"),
  ]);

  const claimed = assignments.length;
  const inProgress = assignments.filter((a: any) => a.status === "IN_PROGRESS").length;
  const completed = assignments.filter((a: any) => a.status === "COMPLETED").length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Welcome back, {user.name || "Booster"}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Verification: {boosterProfile.verificationStatus} • Availability: {boosterProfile.availabilityStatus}
        </p>
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
          <div className="text-sm text-zinc-400">In Progress</div>
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
          <a href="/dashboard/booster/available-orders" className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600">
            Browse Available Orders
          </a>
          <a href="/dashboard/booster/claimed-orders" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">
            My Claimed Orders
          </a>
          <a href="/dashboard/booster/profile" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">
            My Profile
          </a>
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
