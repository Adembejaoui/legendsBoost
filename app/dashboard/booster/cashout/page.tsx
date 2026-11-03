import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect } from "@/lib/dashboard/role-routing";

export default async function CashoutPage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster/cashout",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  const user = ctx.user;
  const boosterStatus = ctx.boosterProfile?.verificationStatus ?? null;

  if (user.role === "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/booster/cashout",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster/cashout",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect("/dashboard/admin");
  }
  if (user.role !== "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/booster/cashout",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for cashout",
    });
    redirect("/login");
  }
  if (!ctx.boosterProfile || ctx.boosterProfile.verificationStatus !== "APPROVED") {
    devLogRedirect({
      from: "/dashboard/booster/cashout",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Booster profile not approved; booster dashboard renders account status",
    });
    redirect("/dashboard/booster");
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Cashout</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage your earnings and withdrawals
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-white">Coming Soon</h2>
        <p className="mb-4 text-zinc-400">
          Earnings and cashout functionality will become available when the financial system is implemented.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-white/5 p-4">
            <div className="text-sm text-zinc-400">Available Balance</div>
            <div className="mt-1 text-xl font-semibold text-white">--</div>
          </div>
          <div className="rounded-lg bg-white/5 p-4">
            <div className="text-sm text-zinc-400">Pending Earnings</div>
            <div className="mt-1 text-xl font-semibold text-white">--</div>
          </div>
          <div className="rounded-lg bg-white/5 p-4">
            <div className="text-sm text-zinc-400">Total Earnings</div>
            <div className="mt-1 text-xl font-semibold text-white">--</div>
          </div>
          <div className="rounded-lg bg-white/5 p-4">
            <div className="text-sm text-zinc-400">Payout Methods</div>
            <div className="mt-1 text-xl font-semibold text-white">--</div>
          </div>
        </div>
      </div>
    </div>
  );
}
