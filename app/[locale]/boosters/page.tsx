import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { listPublicBoosters } from "@/lib/boosters/public-profile";

export const metadata: Metadata = {
  title: "Our boosters — LegendsBoost",
  description: "Verified boosters, their games, ratings and reviews from real orders.",
};
export const dynamic = "force-dynamic";

/** Public list of active boosters who chose a public name. */
export default async function BoostersPage() {
  const boosters = await listPublicBoosters();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-5 pb-24 pt-24 sm:px-8 sm:pt-28 lg:px-10">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">Our boosters</h1>
        <p className="mt-3 max-w-xl text-sm text-zinc-400">
          Every booster is verified by our team. Ratings come only from customers of completed orders.
        </p>
        {boosters.length === 0 ? (
          <p className="mt-10 text-sm text-zinc-500">No public booster profiles yet.</p>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boosters.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/boosters/${encodeURIComponent(b.displayName)}`}
                  className="block h-full rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#C8AA6E]/40"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="truncate text-lg font-semibold text-white">{b.displayName}</h2>
                    <span className="shrink-0 text-sm text-[#e3c98f]">
                      {b.rating.average !== null ? `★ ${b.rating.average} (${b.rating.count})` : "No reviews yet"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {b.completedOrders} completed order{b.completedOrders === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-zinc-300">
                    {b.games.map((g) => (
                      <li key={g.slug}>
                        {g.name} <span className="text-zinc-500">· up to {g.upTo}</span>
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
