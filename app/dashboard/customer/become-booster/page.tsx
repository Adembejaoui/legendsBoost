import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import { BecomeBoosterForm } from "./BecomeBoosterForm";
import { ApplicationStatusView } from "./ApplicationStatusView";

export default async function BecomeBoosterPage() {
  const ctx = await getDashboardContext({ includeCustomerProfile: true , includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/customer/become-booster",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }

  const user = ctx.user;
  const boosterStatus = ctx.boosterProfile?.verificationStatus ?? null;
  const applicationStatus =
  ctx.boosterProfile?.verificationStatus ?? null;

  if (user.role === "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/customer/become-booster",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "BOOSTER must use the booster dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/customer/become-booster",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role !== "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/customer/become-booster",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for booster application page",
    });
    redirect("/login");
  }

  if (ctx.boosterProfile?.verificationStatus === "APPROVED") {
    devLogRedirect({
      from: "/dashboard/customer/become-booster",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Approved boosters use the booster dashboard",
    });
    redirect("/dashboard/booster");
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Booster Application</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Become a Booster</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Share your gaming expertise and availability. Applications are reviewed by our admin team.
          We never ask for game account passwords or login credentials.
        </p>
      </div>

     {/* Application status */}
{(applicationStatus === "PENDING" ||
  applicationStatus === "REJECTED") && (
  <ApplicationStatusView
    status={applicationStatus}
    rejectionReason={ctx.boosterProfile?.rejectionReason ?? null}
    canReapply={applicationStatus === "REJECTED"}
  />
)}

{/* Application form */}
{(applicationStatus === null ||
  applicationStatus === "REJECTED") && (
  <BecomeBoosterForm
    initialName={user.name ?? ""}
    initialEmail={user.email ?? ""}
    initialCountry={ctx.customerProfile?.country ?? ""}
    initialPhone={ctx.customerProfile?.phoneNumber ?? ""}
  />
)}
    </div>
  );
}
