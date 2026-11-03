import type { GameDefinition } from '@/types/catalog'
import { getGame, getGames } from '@/lib/catalog/games'
import { getOffersWithTemplate } from '@/lib/catalog/catalog-utils'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { GameHero } from '@/components/games/GameHero'
import { GameServiceSection } from '@/components/games/GameServiceSection'
import { HowItWorks } from '@/components/home/sections'
import { FaqAccordion } from '@/components/game/faq-accordion'
import { RelatedGames } from '@/components/game/related-games'
import { gameFaqs } from '@/lib/game-faqs'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Game } from '@/types/game'

interface GamePageProps {
  params: Promise<{ gameSlug: string }>
}

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { gameSlug } = await params
  const game = getGame(gameSlug)
  if (!game) {
    return { title: 'Game not found — LegendsBoost' }
  }
  return {
    title: `${game.name} — LegendsBoost`,
    description: game.shortDescription,
  }
}

export async function generateStaticParams() {
  return getGames().map((game) => ({ gameSlug: game.slug }))
}

export default async function GamePage({ params }: GamePageProps) {
  const { gameSlug } = await params
  const game: GameDefinition | undefined = getGame(gameSlug)
  if (!game) {
    notFound()
  }

  const entries = getOffersWithTemplate(gameSlug)
  const otherGames: Game[] = getGames()
    .filter((gameItem) => gameItem.slug !== game.slug) as unknown as Game[]

  return (
    <>
      <SiteHeader />
      <main>
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <Breadcrumb
            items={[
              { label: 'Games', href: '/games' },
              { label: game.name },
            ]}
          />
        </div>
        <GameHero game={game} />

        <GameServiceSection game={game} entries={entries as any} />

        <HowItWorks />

        <FaqAccordion gameFaqs={gameFaqs[game.slug]} />

        <RelatedGames games={otherGames} />
      </main>
      <SiteFooter />
    </>
  )
}
