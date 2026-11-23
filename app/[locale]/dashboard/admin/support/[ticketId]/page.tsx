import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { redirect } from "next/navigation";
import { SupportTicketDetail } from "@/components/support/SupportTicketDetail";

export default async function AdminTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") redirect("/dashboard/admin");

  const { ticketId } = await params;

  return <SupportTicketDetail ticketId={ticketId} isAdmin={true} />;
}