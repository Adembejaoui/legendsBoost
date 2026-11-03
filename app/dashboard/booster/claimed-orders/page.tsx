import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect } from "@/lib/dashboard/role-routing";
import { display } from "@/lib/fonts";
import ClaimedOrdersClient from "./ClaimedOrdersClient";

export default async function ClaimedOrdersPage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster/claimed-orders",
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
      from: "/dashboard/booster/claimed-orders",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster/claimed-orders",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect("/dashboard/admin");
  }
  if (user.role !== "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/booster/claimed-orders",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for claimed orders",
    });
    redirect("/login");
  }
  if (!ctx.boosterProfile || ctx.boosterProfile.verificationStatus !== "APPROVED") {
    devLogRedirect({
      from: "/dashboard/booster/claimed-orders",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "Booster profile not approved; booster dashboard renders account status",
    });
    redirect("/dashboard/booster");
  }

  const { getBoosterAssignments } = await import("@/lib/assignments/service");
  const assignments = await getBoosterAssignments(user.id, "all");

  return (
    <div>
      <div className="mb-8">
        <h1
          className={`${display.className} text-4xl font-semibold tracking-tight text-white`}
        >
          Claimed orders
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Track the orders you&apos;re working on and review finished ones.
        </p>
      </div>
      <ClaimedOrdersClient initialAssignments={assignments as any} />
    </div>
  );
}