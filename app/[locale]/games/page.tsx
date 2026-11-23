import type { Game } from '@/types/game'
import { getGames } from '@/lib/games'
import { getAvailableServiceCounts } from '@/lib/catalog/storefront'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { CheckoutSteps } from '@/components/checkout/CheckoutSteps'
import { ArrowRight } from 'lucide-react'
import { Link } from "@/i18n/navigation";
import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { useTranslations } from 'next-intl'
import { catalogText } from '@/lib/i18n/catalog'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Games')
  return { title: t('metaTitle'), description: t('metaDescription') }
}

// Service counts depend on live prices and the Stripe mode: render per request.
export const dynamic = 'force-dynamic'

/** Checkout step 1 of 4: choose a game. Selecting a card goes straight to step 2. */
export default async function GamesPage() {
  const games = getGames()
  const counts = await getAvailableServiceCounts()
  const t = await getTranslations('Games')
  const ct = catalogText(await getLocale())

  return (
    <>
      <SiteHeader />
      <main className="pb-24 pt-24 sm:pt-28">
        <CheckoutSteps current={1} />
        <section className="mx-auto mt-8 max-w-7xl px-5 sm:px-8 lg:px-10">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-400 sm:text-base">
            {t('text')}
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) => (
              <GameChoiceCard key={game.slug} game={{ ...game, description: ct(game.description) }} count={counts[game.slug]} />
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

function GameChoiceCard({ game, count }: { game: Game; count: number | null | undefined }) {
  const t = useTranslations('Games')
  const countLabel = count == null ? t('viewServices') : count === 0 ? t('noServices') : t('servicesAvailable', { count })
  return (
    <Link
      href={`/games/${game.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-all hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400"
      aria-label={t('chooseAria', { name: game.name, count: countLabel })}
    >
      <div className="relative h-40 overflow-hidden sm:h-44">
        {/* eslint-disable-next-line @next/next/no-img-element -- same artwork as before, no optimization needed */}
        <img src={game.image} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111319] via-[#111319]/30 to-transparent" />
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h2 className="text-2xl font-semibold tracking-tight text-white">{game.name}</h2>
        <p className="mt-2 text-sm leading-5 text-zinc-400">{game.description}</p>
        <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4">
          <span className="text-xs font-medium text-zinc-300">{countLabel}</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors group-hover:bg-orange-400">
            {t('choose')}
            <ArrowRight className="size-3.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}
