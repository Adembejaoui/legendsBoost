import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect } from "@/lib/dashboard/role-routing";
import AvailableOrdersClient from "./AvailableOrdersClient";

export default async function AvailableOrdersPage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster/available-orders",
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
      from: "/dashboard/booster/available-orders",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster/available-orders",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect("/dashboard/admin");
  }
  if (user.role !== "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/booster/available-orders",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for available orders",
    });
    redirect("/login");
  }
  if (!ctx.boosterProfile || ctx.boosterProfile.verificationStatus !== "APPROVED") {
    devLogRedirect({
      from: "/dashboard/booster/available-orders",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Booster profile not approved; booster dashboard renders account status",
    });
    redirect("/dashboard/booster");
  }

  const { getAvailableOrders } = await import("@/lib/assignments/service");
  const orders = await getAvailableOrders();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Available Orders</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Browse and claim orders from the marketplace
        </p>
      </div>
      <AvailableOrdersClient initialOrders={orders as any} />
    </div>
  );
}
