import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { hasVerifiedPayment } from "@/lib/orders/payment-gate";
import { DraftEditor, type DraftEditorProps } from "./DraftEditor";
import { CompletionCard } from "@/components/admin/CompletionCard";
import { BoosterChangeDecision } from "@/components/admin/BoosterChangeDecision";
import { formatStatusLabel } from "@/lib/orders/status-display";

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

  // Order actions (client PDF 2026-11-22): the admin alert opens this page,
  // so the booster change request and the completion are decided here too.
  const [heldAssignment, changeRequest, completion] = await Promise.all([
    prisma.orderBoosterAssignment.findFirst({
      where: { orderId, status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED", "SUBMITTED"] } },
      select: { boosterId: true, status: true, assignedAt: true },
    }),
    prisma.orderBoosterChangeRequest.findFirst({ where: { orderId, status: "REQUESTED" } }),
    prisma.orderCompletionRequest.findFirst({
      where: { orderId, status: { in: ["PENDING", "DISPUTED"] } },
      include: {
        proofs: { select: { id: true }, orderBy: { createdAt: "asc" } },
        order: { select: { id: true, gameSlug: true, serviceSlug: true, user: { select: { name: true } } } },
      },
    }),
  ]);
  const boosterIds = [heldAssignment?.boosterId, completion?.boosterId].filter((x): x is string => !!x);
  const boosters = await prisma.user.findMany({ where: { id: { in: boosterIds } }, select: { id: true, name: true, email: true } });
  const nameOf = (id?: string | null) => {
    const b = boosters.find((x) => x.id === id);
    return b?.name ?? b?.email ?? "—";
  };

  return (
    <div className="max-w-3xl space-y-4">
      <section aria-label="Order actions" className="space-y-3 rounded-xl border border-white/[0.07] bg-[#11131a] p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Order actions</h2>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold">{formatStatusLabel(order.status)}</span>
        </div>
        <p className="text-sm text-zinc-300">
          Booster: <span className="font-semibold text-white">{heldAssignment ? nameOf(heldAssignment.boosterId) : "none"}</span>
          {heldAssignment ? <span className="text-zinc-500"> · since {heldAssignment.assignedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span> : null}
        </p>
        {changeRequest ? (
          <div className="space-y-2 rounded-lg border border-violet-400/30 bg-violet-500/[0.06] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-violet-300">Customer asks for a different booster</p>
            <p className="whitespace-pre-wrap text-sm text-zinc-200">{changeRequest.reason}</p>
            <BoosterChangeDecision requestId={changeRequest.id} />
          </div>
        ) : null}
        {completion ? <CompletionCard r={completion} boosterName={nameOf(completion.boosterId)} showTitle={false} /> : null}
        {!changeRequest && !completion ? <p className="text-xs text-zinc-500">Nothing waiting for a decision on this order.</p> : null}
      </section>
      <DraftEditor {...props} />
    </div>
  );
}
