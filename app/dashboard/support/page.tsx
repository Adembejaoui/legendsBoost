import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { redirect } from "next/navigation";
import { SupportTicketList } from "@/components/support/SupportTicketList";

export default async function SupportPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");

  return <SupportTicketList />;
}