import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { DashboardShell, type DashboardUser } from "@/components/dashboard/DashboardShell";
import { BoosterWelcomeModal } from "@/components/dashboard/BoosterWelcomeModal";
import { getUnreadCount } from "@/lib/notifications/service";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";
import { userChannel } from "@/lib/realtime/channel-names";
import { BoosterNewOrderAlert } from "@/components/realtime/BoosterNewOrderAlert";
import { AdminOrderAlert } from "@/components/realtime/AdminOrderAlert";
import { MessageSoundAlert } from "@/components/realtime/MessageSoundAlert";
import { hasBoosterAccess } from "@/lib/boosters/status";
import { VerifyEmailBanner } from "@/components/account/VerifyEmailBanner";

/** Events on the user's own channel that make dashboard pages refetch. */
const USER_LIVE_EVENTS = ["notification.created", "notification.read", "notification.all_read", "live.refresh"] as const;

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

  const unreadCount = await getUnreadCount(ctx.user.id);
  const showOrderAlert = ctx.user.role === "BOOSTER" && hasBoosterAccess(ctx.boosterProfile?.verificationStatus);

  return (
    <DashboardShell role={ctx.user.role} user={dashboardUser} initialUnreadCount={unreadCount}>
      {/* Live: lists, counts and the notification bell update without a refresh. */}
      <LiveRefresh subscriptions={[{ channel: userChannel(ctx.user.id), events: USER_LIVE_EVENTS }]} />
      {/* Boosters: pop-up + sound for new orders on every page. */}
      {showOrderAlert && <BoosterNewOrderAlert />}
      {/* Admins: pop-up + sound for booster change requests and abandoned orders. */}
      {ctx.user.role === "ADMIN" && <AdminOrderAlert userId={ctx.user.id} />}
      {/* Customers and boosters: a ding for chat messages on other pages. */}
      {ctx.user.role !== "ADMIN" && <MessageSoundAlert userId={ctx.user.id} />}
      {!ctx.user.emailVerified && ctx.user.email && ctx.user.role !== "ADMIN" && <VerifyEmailBanner email={ctx.user.email} />}
      {showWelcomeModal && (
        <BoosterWelcomeModal user={ctx.user} boosterProfile={ctx.boosterProfile} />
      )}
      {children}
    </DashboardShell>
  );
}
