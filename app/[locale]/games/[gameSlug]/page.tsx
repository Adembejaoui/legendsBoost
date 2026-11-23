import type { GameDefinition } from '@/types/catalog'
import { getGame, getGames } from '@/lib/catalog/games'
import { getOffersWithTemplate } from '@/lib/catalog/catalog-utils'
import { getStorefrontServices } from '@/lib/catalog/storefront'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { CheckoutSteps } from '@/components/checkout/CheckoutSteps'
import { ServiceGrid } from '@/components/games/ServiceGrid'
import { FaqAccordion } from '@/components/game/faq-accordion'
import { RelatedGames } from '@/components/game/related-games'
import { gameFaqs } from '@/lib/game-faqs'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { catalogText } from '@/lib/i18n/catalog'
import { getRequestCurrency } from '@/lib/currency/server'
import type { Game } from '@/types/game'

interface GamePageProps {
  params: Promise<{ gameSlug: string }>
}

// Status and starting prices come from live prices and the Stripe mode.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { gameSlug } = await params
  const game = getGame(gameSlug)
  const t = await getTranslations('Game')
  if (!game) {
    return { title: t('notFound') }
  }
  return {
    title: t('metaTitle', { name: game.name }),
    description: catalogText(await getLocale())(game.shortDescription),
  }
}

/** Checkout step 2 of 4: choose a service of the selected game. */
export default async function GamePage({ params }: GamePageProps) {
  const { gameSlug } = await params
  const game: GameDefinition | undefined = getGame(gameSlug)
  if (!game) {
    notFound()
  }

  const t = await getTranslations('Game')
  const ct = catalogText(await getLocale())
  const entries = getOffersWithTemplate(gameSlug).map(({ offer, template }) => ({
    offer: { ...offer, title: offer.title && ct(offer.title), description: offer.description && ct(offer.description) },
    template: { ...template, title: ct(template.title), description: ct(template.description) },
  }))
  const storefront = await getStorefrontServices(gameSlug, await getRequestCurrency())
  const available = storefront.filter((s) => s.availability === 'available').length
  const otherGames: Game[] = getGames()
    .filter((gameItem) => gameItem.slug !== game.slug)
    .map((g) => ({ ...g, description: ct(g.description) })) as unknown as Game[]

  return (
    <>
      <SiteHeader />
      <main className="pt-24 sm:pt-28">
        <CheckoutSteps current={2} gameSlug={game.slug} />
        <section id="services" className="mx-auto mt-8 max-w-7xl scroll-mt-24 px-5 pb-20 sm:px-8 lg:px-10">
          <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em]" style={{ color: game.accent }}>
                {game.name}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">{t('chooseService')}</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">{ct(game.shortDescription)}</p>
            </div>
            <span className="text-sm text-zinc-500">
              {t('availableCount', { available, total: entries.length })}
            </span>
          </div>
          <ServiceGrid game={game} entries={entries as never} storefront={storefront} />
        </section>

        <FaqAccordion
          gameFaqs={(gameFaqs[game.slug] ?? []).map((f) => ({ q: ct(f.q), a: ct(f.a) }))}
          eyebrow={t('faqEyebrow')}
          title={t('faqTitle')}
        />

        <RelatedGames games={otherGames} />
      </main>
      <SiteFooter />
    </>
  )
}
