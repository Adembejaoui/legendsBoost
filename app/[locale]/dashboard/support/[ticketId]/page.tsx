import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { redirect } from "next/navigation";
import { SupportTicketDetail } from "@/components/support/SupportTicketDetail";

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");

  const { ticketId } = await params;

  return <SupportTicketDetail ticketId={ticketId} isAdmin={false} />;
}