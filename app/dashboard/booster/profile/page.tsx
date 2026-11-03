import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect } from "@/lib/dashboard/role-routing";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster/profile",
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
      from: "/dashboard/booster/profile",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster/profile",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect("/dashboard/admin");
  }
  if (user.role !== "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/booster/profile",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for booster profile",
    });
    redirect("/login");
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage your booster profile and availability
        </p>
      </div>
      <ProfileClient user={user} boosterProfile={ctx.boosterProfile} />
    </div>
  );
}
