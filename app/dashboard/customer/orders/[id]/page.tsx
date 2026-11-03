import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import { StatusBadge } from "@/components/dashboard/customer/StatusBadge";
import { CustomerOrderTimeline } from "@/components/dashboard/customer/CustomerOrderTimeline";
import { CustomerHeader } from "@/components/dashboard/customer/CustomerHeader";
import { getGame, getServiceTemplate, getGameServiceOffer } from "@/lib/catalog/catalog-utils";
import { RankDisplay } from "@/components/dashboard/customer/RankDisplay";
import prisma from "@/lib/prisma";

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getDashboardContext();
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/customer/orders/[id]",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  const user = ctx.user;
  const boosterStatus = ctx.boosterProfile?.verificationStatus ?? null;

  if (user.role === "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/customer/orders/[id]",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "BOOSTER must use the booster dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/customer/orders/[id]",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role !== "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/customer/orders/[id]",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for customer order page",
    });
    redirect("/login");
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) notFound();
  if (order.userId !== user.id) notFound();

  const game = getGame(order.gameSlug);
  const template = getServiceTemplate(order.serviceSlug);
  const cfg = (order.configuration ?? {}) as Record<string, unknown>;
  const rankSystemId = getGameServiceOffer(order.gameSlug, order.serviceSlug)?.rankSystemId;

  const currentRankSelection =
    cfg["currentRank"] && typeof cfg["currentRank"] === "object"
      ? (cfg["currentRank"] as { tierId: string; divisionId: string | null })
      : null;
  const targetRankSelection =
    cfg["targetRank"] && typeof cfg["targetRank"] === "object"
      ? (cfg["targetRank"] as { tierId: string; divisionId: string | null })
      : null;
  const selectedMode = order.selectedMode ?? null;

  function formatConfigValue(
    order: { gameSlug: string; serviceSlug: string },
    key: string,
    value: unknown,
  ): React.ReactNode {
    if (value === null || value === undefined) return <span className="text-zinc-500">—</span>;
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-zinc-500">—</span>;
      return (
        <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
          {value.map((v, i) => (
            <li key={i}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</li>
          ))}
        </ul>
      );
    }
    if (typeof value === "object") {
      // Known rank selection field
      if ("tierId" in value && typeof (value as { tierId?: unknown }).tierId === "string" && rankSystemId) {
        return (
          <RankDisplay
            gameSlug={order.gameSlug}
            serviceSlug={order.serviceSlug}
            selection={value as { tierId: string; divisionId: string | null }}
          />
        );
      }
      return JSON.stringify(value);
    }
    return String(value);
  }

  return (
    <div className="min-h-screen bg-[#0b0c10] text-white">
      <CustomerHeader
        title="Order Details"
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard/customer" },
          { label: "Order Details", href: `/dashboard/customer/orders/${order.id}` },
        ]}
      />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href="/dashboard/customer"
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
          Back to orders
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Order header & status */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Order #{order.id.slice(-6).toUpperCase()}
                  </h2>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-white/10">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Game</h3>
                  <p className="text-sm text-white">{game?.name ?? order.gameSlug}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Service</h3>
                  <p className="text-sm text-white">{template?.title ?? order.serviceSlug}</p>
                </div>
                {selectedMode && (
                  <div className="sm:col-span-2">
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Mode</h3>
                    <p className="text-sm text-white">{selectedMode}</p>
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

            {(currentRankSelection || targetRankSelection) && rankSystemId && (
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
                        "—"
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
                        "—"
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

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

          {/* Right column: Order summary */}
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
                  <dt className="text-zinc-400">Created</dt>
                  <dd className="text-white">{new Date(order.createdAt).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-400">Last updated</dt>
                  <dd className="text-white">{new Date(order.updatedAt).toLocaleString()}</dd>
                </div>
              </dl>
            </div>

            {Object.keys(cfg).length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Configuration</h3>
                <div className="space-y-3">
                  {Object.entries(cfg).map(([key, value]) => {
                    const label = key
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (str) => str.toUpperCase());
                    // Skip internal rank fields that are already displayed above
                    if (key === "currentRank" || key === "targetRank") return null;
                    return (
                      <div key={key} className="flex justify-between text-sm border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                        <dt className="text-zinc-400">{label}</dt>
                        <dd className="text-white truncate max-w-[200px]">{formatConfigValue(order, key, value)}</dd>
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
