import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";

export default async function AdminDashboardPage() {
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
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Admin Overview</h1>
      <p className="mt-2 text-sm text-zinc-400">Admin dashboard coming soon.</p>
    </div>
  );
}
