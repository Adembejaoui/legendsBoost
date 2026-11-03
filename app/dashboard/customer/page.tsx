import { redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import prisma from "@/lib/prisma";
import { $Enums } from "@/app/generated/prisma/client";
import { ACTIVE_ORDER_STATUSES } from "@/lib/orders/statuses";
import { CustomerStats } from "@/components/dashboard/customer/CustomerStats";
import { CustomerOrderCard } from "@/components/dashboard/customer/CustomerOrderCard";
import { CustomerOrderFilter } from "@/components/dashboard/customer/CustomerOrderFilter";
import { CustomerEmptyState } from "@/components/dashboard/customer/CustomerEmptyState";
import { CustomerProfileCard } from "@/components/dashboard/customer/CustomerProfileCard";

const LIMIT = 10;

function buildHref(tab: string, status: string | undefined, page: number) {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("tab", tab);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/dashboard/customer?${qs}` : "/dashboard/customer";
}

export default async function CustomerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string; page?: string }>;
}) {
  const ctx = await getDashboardContext({
    includeCustomerProfile: true,
    includeBoosterProfile: true,
  });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/customer",
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
      from: "/dashboard/customer",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "BOOSTER must use the booster dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/customer",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role !== "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/customer",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for customer dashboard",
    });
    redirect("/login");
  }

  const sp = await searchParams;
  const validStatuses = Object.values($Enums.OrderStatus);
  const statusFilter =
    sp.status && validStatuses.includes(sp.status as $Enums.OrderStatus)
      ? (sp.status as $Enums.OrderStatus)
      : undefined;

  const tab = sp.tab && ["all", "active", "completed", "cancelled"].includes(sp.tab)
    ? (sp.tab as "all" | "active" | "completed" | "cancelled")
    : "all";

  const requestedPage = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const where: { userId: string; status?: $Enums.OrderStatus | { in: $Enums.OrderStatus[] } } = {
    userId: user.id,
  };

  if (statusFilter) {
    where.status = statusFilter;
  } else if (tab === "active") {
    where.status = { in: ACTIVE_ORDER_STATUSES };
  } else if (tab === "completed") {
    where.status = $Enums.OrderStatus.COMPLETED;
  } else if (tab === "cancelled") {
    where.status = $Enums.OrderStatus.CANCELLED;
  }

  const [total, totalOrders, activeOrders, completedOrders, cancelledOrders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.count({ where: { userId: user.id } }),
    prisma.order.count({ where: { userId: user.id, status: { in: ACTIVE_ORDER_STATUSES } } }),
    prisma.order.count({ where: { userId: user.id, status: $Enums.OrderStatus.COMPLETED } }),
    prisma.order.count({ where: { userId: user.id, status: $Enums.OrderStatus.CANCELLED } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  if (requestedPage > totalPages) {
    devLogRedirect({
      from: "/dashboard/customer",
      to: buildHref(tab, statusFilter, totalPages),
      databaseRole: user.role,
      boosterStatus,
      reason: "Requested page out of range; paginate to last page",
    });
    redirect(buildHref(tab, statusFilter, totalPages));
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (requestedPage - 1) * LIMIT,
    take: LIMIT,
  });

  const counts = {
    all: totalOrders,
    active: activeOrders,
    completed: completedOrders,
    cancelled: cancelledOrders,
  };

  const displayName = (user.name || user.email) ?? "";

  return (
    <div>
      <header className="mb-8 border-b border-white/10 pb-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Welcome back, {displayName}</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Here is your order overview. Pick a game and service to place your first order, or check the status of an existing one.
            </p>
          </div>
          <Link
            href="/games"
            className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            Browse games
          </Link>
        </div>
      </header>

        <CustomerStats
          total={totalOrders}
          active={activeOrders}
          completed={completedOrders}
        />

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Your orders</h2>
              <p className="text-sm text-zinc-400">
                {total === 0
                  ? "No orders yet"
                  : `Showing ${(requestedPage - 1) * LIMIT + 1}–${Math.min(requestedPage * LIMIT, total)} of ${total}`}
              </p>
            </div>

              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {[
                    { key: "all", label: "All", count: counts.all },
                    { key: "active", label: "Active", count: counts.active },
                    { key: "completed", label: "Completed", count: counts.completed },
                    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
                  ].map((item) => {
                    const isActive = tab === item.key;
                    const href = buildHref(item.key, undefined, 1);
                    return (
                      <Link
                        key={item.key}
                        href={href}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-violet-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.25)]"
                            : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                        }`}
                      >
                        {item.label}
                        {item.count > 0 && (
                          <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">
                            {item.count}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
                <CustomerOrderFilter
                  options={[
                    { label: "All statuses", value: "" },
                    ...validStatuses.map((s) => ({
                      label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                      value: s,
                    })),
                  ]}
                  selectedValue={statusFilter ?? ""}
                />
                {statusFilter && (
                  <Link
                    href={buildHref("all", undefined, 1)}
                    className="rounded-lg px-3 py-2.5 text-sm text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  >
                    Clear
                  </Link>
                )}
              </div>
          </div>

          {orders.length > 0 ? (
            <ul className="mt-6 space-y-3">
              {orders.map((o) => (
                <li key={o.id}>
                  <CustomerOrderCard
                    order={{
                      id: o.id,
                      gameSlug: o.gameSlug,
                      serviceSlug: o.serviceSlug,
                      status: o.status,
                      createdAt: o.createdAt,
                      selectedMode: o.selectedMode,
                      price: o.price ? Number(o.price) : null,
                      currency: o.currency,
                      configuration: o.configuration as Record<string, unknown> | null,
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <CustomerEmptyState variant={statusFilter ? "filtered" : "default"} />
          )}

          {totalPages > 1 && orders.length > 0 && (
            <nav className="mt-8 flex items-center justify-between pt-4 text-sm">
              {requestedPage > 1 ? (
                <Link
                  href={buildHref(tab, statusFilter, requestedPage - 1)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-zinc-200 transition hover:bg-white/10 hover:text-white"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-lg px-4 py-2 text-zinc-500">Previous</span>
              )}
              <span className="text-zinc-400">
                Page {requestedPage} of {totalPages}
              </span>
              {requestedPage < totalPages ? (
                <Link
                  href={buildHref(tab, statusFilter, requestedPage + 1)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-zinc-200 transition hover:bg-white/10 hover:text-white"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded-lg px-4 py-2 text-zinc-500">Next</span>
              )}
            </nav>
          )}
        </section>

        
      </div>
  );
}
