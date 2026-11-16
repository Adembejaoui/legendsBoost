import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getPublicBooster } from "@/lib/boosters/public-profile";
import { getGame } from "@/lib/catalog/games";
import { ChooseBoosterButton } from "@/components/boosters/ChooseBoosterButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  return { title: `${decodeURIComponent(name)} — LegendsBoost booster` };
}

/** Public booster profile: games, rating, reviews, and a way to choose them. */
export default async function BoosterProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const b = await getPublicBooster(decodeURIComponent(name));
  if (!b) notFound();
  const ratingLine =
    b.rating.average !== null
      ? ` · ★ ${b.rating.average} from ${b.rating.count} review${b.rating.count === 1 ? "" : "s"} · ${b.rating.fiveStarPercent}% five stars`
      : " · no reviews yet";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 pb-24 pt-24 sm:px-8 sm:pt-28">
        <Link href="/boosters" className="text-sm text-zinc-400 hover:text-white">
          ← All boosters
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">{b.displayName}</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {b.completedOrders} completed order{b.completedOrders === 1 ? "" : "s"}
              {ratingLine}
            </p>
          </div>
          <ChooseBoosterButton boosterId={b.id} name={b.displayName} />
        </div>

        <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold text-white">Games</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            {b.games.map((g) => (
              <li key={g.slug}>
                {g.name} <span className="text-zinc-500">· up to {g.upTo}</span>
              </li>
            ))}
          </ul>
          {b.rating.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {b.rating.tags.map((t) => (
                <span key={t.tag} className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-zinc-200">
                  {t.tag} · {t.count}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-semibold text-white">Reviews</h2>
          {b.reviews.length === 0 ? (
            <p className="text-sm text-zinc-500">No reviews yet.</p>
          ) : (
            b.reviews.map((r) => (
              <article key={r.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[#e3c98f]" aria-label={`${r.rating} out of 5`}>
                    {"★".repeat(r.rating)}
                    <span className="text-zinc-700">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {getGame(r.order.gameSlug)?.name ?? r.order.gameSlug} · {r.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                {r.tags.length > 0 ? <p className="text-xs text-zinc-400">{r.tags.join(" · ")}</p> : null}
                {r.text ? <p className="text-zinc-300">{r.text}</p> : null}
                {r.reply ? (
                  <p className="border-l-2 border-[#C8AA6E]/40 pl-2 text-zinc-400">
                    <span className="font-semibold text-zinc-300">{b.displayName}: </span>
                    {r.reply}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
