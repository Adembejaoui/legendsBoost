import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getOrderWorkspace, getInitialChatMessages } from "@/lib/orders/workspace-data";
import OrderWorkspace from "@/components/orders/workspace/OrderWorkspace";
import type { RawServerMessage } from "@/lib/chat/message-sync";
import { hasBoosterAccess } from "@/lib/boosters/status";

export const dynamic = "force-dynamic";

/**
 * Order workspace: one page for the customer, the assigned booster and
 * admins. Access is resolved server-side by resolveWorkspaceAccess; anyone
 * else gets a 404 (no disclosure that the order exists).
 */
export default async function OrderWorkspacePage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) redirect("/login");
  const { orderId } = await params;

  // Boosters must be approved (pending/rejected/suspended get no access).
  if (ctx.user.role === "BOOSTER" && !hasBoosterAccess(ctx.boosterProfile?.verificationStatus)) notFound();

  const data = await getOrderWorkspace(orderId, {
    id: ctx.user.id,
    email: ctx.user.email ?? null,
    role: ctx.user.role,
    name: ctx.user.name,
    image: ctx.user.image,
  });
  if (!data) notFound();

  const initialMessages = data.conversationId
    ? ((await getInitialChatMessages(data.conversationId)) as unknown as RawServerMessage[])
    : [];

  return <OrderWorkspace data={data} initialMessages={initialMessages} />;
}
