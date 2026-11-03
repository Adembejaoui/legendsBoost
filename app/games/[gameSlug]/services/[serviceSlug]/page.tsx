import { getOfferWithTemplate } from '@/lib/catalog/catalog-utils'
import { getGameServiceOffers } from '@/lib/catalog/game-services'
import { getRankSystemsByGame } from '@/lib/catalog/rank-systems'
import { getChampions } from '@/lib/catalog/champions'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { ServiceConfiguratorNew } from '@/components/service-configurator/ServiceConfiguratorNew'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

interface ServicePageProps {
  params: Promise<{ gameSlug: string; serviceSlug: string }>
}

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { gameSlug, serviceSlug } = await params
  const entry = getOfferWithTemplate(gameSlug, serviceSlug)
  if (!entry) {
    return { title: 'Service not found — LegendsBoost' }
  }
  return {
    title: `${entry.offer.title ?? entry.template.title} — ${entry.game.name} — LegendsBoost`,
    description: entry.offer.description ?? entry.template.description,
  }
}

export async function generateStaticParams() {
  const gameSlugs = ['league-of-legends', 'valorant', 'teamfight-tactics'] as const
  const combos: { gameSlug: string; serviceSlug: string }[] = []
  for (const gameSlug of gameSlugs) {
    for (const offer of getGameServiceOffers(gameSlug)) {
      combos.push({ gameSlug, serviceSlug: offer.serviceSlug })
    }
  }
  return combos
}

export default async function ServicePage({ params }: ServicePageProps) {
  const { gameSlug, serviceSlug } = await params
  const entry = getOfferWithTemplate(gameSlug, serviceSlug)
  if (!entry) {
    notFound()
  }

  const { game, offer, template } = entry
  const rankSystems = getRankSystemsByGame(game.slug)
  const champions = getChampions()

  // Pass only serializable data
  const gameSerializable = {
    slug: game.slug,
    name: game.name,
    accent: game.accent,
  }
  const offerSerializable = {
    gameSlug: offer.gameSlug,
    serviceSlug: offer.serviceSlug,
    title: offer.title,
    description: offer.description,
    availability: offer.availability,
    availabilityLabel: offer.availabilityLabel,
    fields: offer.fields,
    pricing: offer.pricing,
  }
  const templateSerializable = {
    slug: template.slug,
    title: template.title,
    description: template.description,
    category: template.category,
  }

  return (
    <>
      <SiteHeader />
      <main className="py-10">
        <ServiceConfiguratorNew
          game={gameSerializable}
          offer={offerSerializable as any}
          template={templateSerializable}
          rankSystems={rankSystems}
          champions={champions}
        />
      </main>
      <SiteFooter />
    </>
  )
}
