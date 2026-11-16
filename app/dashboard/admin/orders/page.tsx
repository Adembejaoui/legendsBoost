import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { listDraftOrders } from "@/lib/orders/draft-admin.service";
import { getGame } from "@/lib/catalog/games";
import { getServiceTemplate } from "@/lib/catalog/service-templates";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const drafts = await listDraftOrders();

  return (
    <div className="text-white">
      <h1 className="text-2xl font-bold">Orders awaiting review</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Orders abandoned by a booster are held as drafts. They are not visible to boosters until you republish them.
      </p>

      {drafts.length === 0 ? (
        <div className="mt-8 rounded-xl border border-white/[0.07] bg-[#11131a] p-10 text-center text-sm text-zinc-400">
          No draft orders. Nothing needs review.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {drafts.map((d) => (
            <li key={d.id} className="rounded-xl border border-white/[0.07] bg-[#11131a] p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {getServiceTemplate(d.serviceSlug)?.title ?? d.serviceSlug}{" "}
                    <span className="text-zinc-500">#{d.id.slice(-8).toUpperCase()}</span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    {getGame(d.gameSlug)?.name ?? d.gameSlug} · {d.customer.name ?? d.customer.email}
                    {d.abandonedAt ? ` · abandoned ${new Date(d.abandonedAt).toLocaleString()}` : ""}
                  </p>
                  {d.abandonReason && (
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-300">&ldquo;{d.abandonReason}&rdquo;</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/${d.id}`}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/5"
                  >
                    Workspace
                  </Link>
                  <Link
                    href={`/dashboard/admin/orders/${d.id}`}
                    className="rounded-lg bg-[#C8AA6E] px-3 py-1.5 text-sm font-semibold text-[#0A0E14] hover:bg-[#d8bc85]"
                  >
                    Review
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
