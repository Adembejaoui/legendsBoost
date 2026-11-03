import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";

export default async function DashboardIndexPage() {
  const ctx = await getDashboardContext();
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }

  const destination = getRoleHomePath(ctx.user.role);
  devLogRedirect({
    from: "/dashboard",
    to: destination,
    databaseRole: ctx.user.role,
    boosterStatus: ctx.boosterProfile?.verificationStatus ?? null,
    reason: "Authoritative database role routes to canonical dashboard",
  });
  redirect(destination);
}
