import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { redirect } from "next/navigation";
import { SupportTicketList } from "@/components/support/SupportTicketList";

export default async function AdminSupportPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") redirect("/dashboard/admin");

  return <SupportTicketList isAdmin={true} />;
}