import { redirect } from "next/navigation";

// Alias: /dashboard/orders/:id -> the canonical workspace at /dashboard/:id
// (which notification links and dashboards already use).
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  redirect(`/dashboard/${orderId}`);
}
