import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import ApplicationsList from "./ApplicationsList";

export default async function AdminApplicationsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/admin/applications",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  if (ctx.user.role === "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/admin/applications",
      to: "/dashboard/customer",
      databaseRole: ctx.user.role,
      boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect(getRoleHomePath(ctx.user.role));
  }
  if (ctx.user.role === "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/admin/applications",
      to: "/dashboard/booster",
      databaseRole: ctx.user.role,
      boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
      reason: "BOOSTER must use the booster dashboard",
    });
    redirect(getRoleHomePath(ctx.user.role));
  }
  if (ctx.user.role !== "ADMIN") {
    devLogRedirect({
      from: "/dashboard/admin/applications",
      to: "/login",
      databaseRole: ctx.user.role,
      boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
      reason: "Unauthorized role for admin applications page",
    });
    redirect("/login");
  }

  return <ApplicationsList />;
}
