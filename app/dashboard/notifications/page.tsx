import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { redirect } from "next/navigation";
import NotificationCenter from "@/components/notifications/NotificationCenter";

export default async function NotificationsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");

  return <NotificationCenter />;
}