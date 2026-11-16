import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { hasVerifiedPayment } from "@/lib/orders/payment-gate";
import { DraftEditor, type DraftEditorProps } from "./DraftEditor";

export const dynamic = "force-dynamic";

export default async function AdminDraftOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const { orderId } = await params;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 30 },
      user: { select: { name: true, email: true } },
      pricingSnapshot: { select: { id: true } },
    },
  });
  if (!order) notFound();

  const offer = getGameServiceOffer(order.gameSlug, order.serviceSlug);
  const rankSystem = offer?.rankSystemId ? getRankSystem(offer.rankSystemId) : undefined;
  const checkout = getCheckoutConfig(order.gameSlug, order.serviceSlug);
  const abandon = order.events.find((e) => e.type === "BOOSTER_ABANDONED");

  const props: DraftEditorProps = {
    order: {
      id: order.id,
      status: order.status,
      serviceTitle: offer?.title ?? order.serviceSlug,
      customer: order.user.name ?? order.user.email,
      configuration: (order.configuration ?? {}) as Record<string, unknown>,
      selectedOptions: order.selectedOptions,
      selectedMode: order.selectedMode,
      price: order.price?.toString() ?? "",
      currency: order.currency ?? "",
      paymentVerified: hasVerifiedPayment(order),
      priceLocked: !!order.pricingSnapshot,
    },
    abandonReason: abandon ? ((abandon.metadata as { reason?: string } | null)?.reason ?? abandon.message) : null,
    fields: (offer?.fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: !!f.required,
      min: "min" in f ? f.min : undefined,
      max: "max" in f ? f.max : undefined,
      options: "options" in f ? f.options.map((o) => ({ label: o.label, value: o.value })) : undefined,
    })),
    tiers: (rankSystem?.tiers ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      divisions: (t.divisions ?? []).map((d) => ({ id: d.id, label: d.label })),
    })),
    checkoutOptions: (checkout?.options ?? []).map((o) => ({ id: o.id, label: o.label })),
    modes: (checkout?.modes ?? []).map((m) => ({ id: m.id, label: m.label })),
    history: order.events
      .filter((e) => ["BOOSTER_ABANDONED", "ORDER_MOVED_TO_DRAFT", "DRAFT_EDITED", "ORDER_REPUBLISHED"].includes(e.type))
      .map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
  };

  return <DraftEditor {...props} />;
}
