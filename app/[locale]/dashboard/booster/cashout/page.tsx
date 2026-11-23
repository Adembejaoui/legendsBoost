import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect } from "@/lib/dashboard/role-routing";
import { boosterFinance } from "@/lib/finance/queries";
import { BoosterEarnings } from "@/components/finance/BoosterEarnings";
import { PayoutMethodCard } from "@/components/finance/PayoutMethodCard";
import { getPayoutMethodStatus } from "@/lib/finance/payout-methods";
import { hasBoosterAccess } from "@/lib/boosters/status";

export const dynamic = "force-dynamic";

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
  if (!ctx.boosterProfile || !hasBoosterAccess(ctx.boosterProfile.verificationStatus)) {
    devLogRedirect({
      from: "/dashboard/booster/cashout",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Booster profile not approved; booster dashboard renders account status",
    });
    redirect("/dashboard/booster");
  }

  // All figures come from the ledger and the booster's own earning / payout
  // records (never another booster's).
  const [finance, method] = await Promise.all([boosterFinance(user.id), getPayoutMethodStatus(user.id)]);
  return (
    <div>
      <PayoutMethodCard readiness={{ kycStatus: ctx.boosterProfile.kycStatus, method }} />
      <BoosterEarnings data={finance} />
    </div>
  );
}
