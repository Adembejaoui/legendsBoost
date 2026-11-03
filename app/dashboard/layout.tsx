import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { DashboardShell, type DashboardUser } from "@/components/dashboard/DashboardShell";
import { BoosterWelcomeModal } from "@/components/dashboard/BoosterWelcomeModal";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) redirect("/login");
  const dashboardUser: DashboardUser = {
    id: ctx.user.id,
    name: ctx.user.name ?? null,
    email: ctx.user.email ?? null,
    image: ctx.user.image ?? null,
    role: ctx.user.role,
  };

  const showWelcomeModal =
    ctx.user.role === "BOOSTER" && ctx.boosterProfile && !ctx.boosterProfile.welcomeModalSeen;

  return (
    <DashboardShell role={ctx.user.role} user={dashboardUser}>
      {showWelcomeModal && (
        <BoosterWelcomeModal user={ctx.user} boosterProfile={ctx.boosterProfile} />
      )}
      {children}
    </DashboardShell>
  );
}
