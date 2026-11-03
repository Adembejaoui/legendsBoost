import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import { StatusBadge } from "@/components/dashboard/customer/StatusBadge";
import { CustomerOrderTimeline } from "@/components/dashboard/customer/CustomerOrderTimeline";
import { getGame, getServiceTemplate } from "@/lib/catalog/catalog-utils";
import { RankDisplay } from "@/components/dashboard/customer/RankDisplay";
import prisma from "@/lib/prisma";
import { OrderActions } from "./OrderActions";

export default async function BoosterOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster/orders/[orderId]",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  const user = ctx.user;
  const boosterStatus = ctx.boosterProfile?.verificationStatus ?? null;

  if (user.role === "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/booster/orders/[orderId]",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role !== "BOOSTER" && user.role !== "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster/orders/[orderId]",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for booster order details",
    });
    redirect("/login");
  }

  const { orderId } = await params;

  const isAdmin = user.role === "ADMIN";

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      events: { orderBy: { createdAt: "asc" } },
        assignments: {
          orderBy: { assignedAt: "desc" },
          select: {
            id: true,
            boosterId: true,
            orderId: true,
            activeOrderId: true,
            status: true,
            assignedAt: true,
            startedAt: true,
            endedAt: true,
            endReason: true,
            booster: { select: { id: true, name: true, email: true } },
          },
        },
      user: { select: { id: true, name: true } },
    },
  });

  if (!order) {
    notFound();
  }

  let ownAssignment: {
    boosterId: string;
    orderId: string;
    id: string;
    status: string;
    activeOrderId: string | null;
    assignedAt: Date;
    startedAt: Date | null;
    endedAt: Date | null;
    endReason: string | null;
    booster: { id: string; name: string | null };
  } | undefined;

  if (!isAdmin) {
    ownAssignment = order.assignments.find(
      (a) => a.boosterId === user.id && a.activeOrderId === order.id
    );

    if (!ownAssignment) {
      // Only the assigned booster may view booster-order details.
      notFound();
    }
  }

  const displayAssignment = ownAssignment ?? order.assignments[0];
  const canManageOrder = !isAdmin && Boolean(ownAssignment);

  const game = getGame(order.gameSlug);
  const template = getServiceTemplate(order.serviceSlug);
  const cfg = (order.configuration ?? {}) as Record<string, unknown>;
  const rankSystemId = undefined;

  const currentRankSelection =
    cfg["currentRank"] && typeof cfg["currentRank"] === "object"
      ? (cfg["currentRank"] as { tierId: string; divisionId: string | null })
      : null;
  const targetRankSelection =
    cfg["targetRank"] && typeof cfg["targetRank"] === "object"
      ? (cfg["targetRank"] as { tierId: string; divisionId: string | null })
      : null;

  return (
    <div className="min-h-screen bg-[#0b0c10] text-white">
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Order #{order.id.slice(-6).toUpperCase()}</h1>
            <p className="text-sm text-zinc-400">
              Placed {new Date(order.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        <Link
          href="/dashboard/booster/claimed-orders"
          className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 mb-6"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to my orders
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: order header & status */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-white/10">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Game</h3>
                  <p className="text-sm text-white">{game?.name ?? order.gameSlug}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Service</h3>
                  <p className="text-sm text-white">{template?.title ?? order.serviceSlug}</p>
                </div>
                {order.selectedMode && (
                  <div className="sm:col-span-2">
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Mode</h3>
                    <p className="text-sm text-white">{order.selectedMode}</p>
                  </div>
                )}
                {order.price != null && order.currency && (
                  <div className="sm:col-span-2">
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Total</h3>
                    <p className="text-sm font-bold tabular-nums text-white">
                      {order.price.toString()} {order.currency}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Rank progression</h3>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Current rank</p>
                  <p className="text-sm font-medium text-white">
                    {currentRankSelection ? (
                      <RankDisplay
                        gameSlug={order.gameSlug}
                        serviceSlug={order.serviceSlug}
                        selection={currentRankSelection}
                      />
                    ) : (
                      <span className="text-zinc-500">Not specified</span>
                    )}
                  </p>
                </div>
                <div className="flex h-1 w-16 bg-white/5 rounded-full">
                  <div className="h-full bg-violet-500 rounded-full" style={{ width: "60%" }} />
                </div>
                <div className="text-center">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Target rank</p>
                  <p className="text-sm font-medium text-violet-400">
                    {targetRankSelection ? (
                      <RankDisplay
                        gameSlug={order.gameSlug}
                        serviceSlug={order.serviceSlug}
                        selection={targetRankSelection}
                      />
                    ) : (
                      <span className="text-zinc-500">Not specified</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Order timeline</h3>
              <CustomerOrderTimeline
                events={order.events.map((e) => ({
                  id: e.id,
                  type: e.type,
                  message: e.message,
                  createdAt: e.createdAt,
                }))}
                orderStatus={order.status}
              />
            </div>
          </div>

          {/* Right column: order summary & actions */}
          <div className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Order summary</h3>
              <dl className="space-y-4">
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-400">Order ID</dt>
                  <dd className="text-white font-mono">{order.id}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-400">Status</dt>
                  <dd className="text-white">{order.status}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-400">Customer</dt>
                  <dd className="text-white">{order.user.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-400">Created</dt>
                  <dd className="text-white">{new Date(order.createdAt).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-400">Last updated</dt>
                  <dd className="text-white">{new Date(order.updatedAt).toLocaleString()}</dd>
                </div>
              </dl>
            </div>

            {canManageOrder && (
              <OrderActions
                orderId={order.id}
                status={order.status}
                assignmentId={ownAssignment!.id}
                assignmentStatus={ownAssignment!.status}
              />
            )}

            {displayAssignment ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Assignment details</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <dt className="text-zinc-400">Assigned booster</dt>
                    <dd className="text-white">
                      {displayAssignment.booster.name ?? displayAssignment.booster.id.slice(-8).toUpperCase()}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-zinc-400">Assignment status</dt>
                    <dd className="text-white">{displayAssignment.status}</dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-zinc-400">Assigned at</dt>
                    <dd className="text-white">{new Date(displayAssignment.assignedAt).toLocaleString()}</dd>
                  </div>
                  {displayAssignment.startedAt && (
                    <div className="flex justify-between text-sm">
                      <dt className="text-zinc-400">Started at</dt>
                      <dd className="text-white">{new Date(displayAssignment.startedAt).toLocaleString()}</dd>
                    </div>
                  )}
                  {displayAssignment.endedAt && (
                    <div className="flex justify-between text-sm">
                      <dt className="text-zinc-400">Ended at</dt>
                      <dd className="text-white">{new Date(displayAssignment.endedAt).toLocaleString()}</dd>
                    </div>
                  )}
                  {displayAssignment.endReason && (
                    <div className="flex justify-between text-sm">
                      <dt className="text-zinc-400">End reason</dt>
                      <dd className="text-zinc-300">{displayAssignment.endReason}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm text-zinc-400">No assignment on record for this order.</p>
              </div>
            )}

            {Object.keys(cfg).length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Configuration</h3>
                <div className="space-y-3">
                  {Object.entries(cfg).map(([key, value]) => {
                    const label = key
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (str) => str.toUpperCase());
                    if (key === "currentRank" || key === "targetRank") return null;
                    return (
                      <div key={key} className="flex justify-between text-sm border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                        <dt className="text-zinc-400">{label}</dt>
                        <dd className="text-white truncate max-w-[200px]">
                          {typeof value === "string" ? value : typeof value === "number" ? value.toString() : JSON.stringify(value)}
                        </dd>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
