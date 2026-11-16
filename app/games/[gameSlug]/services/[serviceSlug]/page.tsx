import { getOfferWithTemplate } from '@/lib/catalog/catalog-utils'
import { getRankSystemsByGame } from '@/lib/catalog/rank-systems'
import { getChampions } from '@/lib/catalog/champions'
import { getPurchaseStatus } from '@/lib/orders/order-eligibility'
import { getStorefrontService } from '@/lib/catalog/storefront'
import { getPriceTags } from '@/lib/pricing/price-tags'
import { CheckoutSteps } from '@/components/checkout/CheckoutSteps'
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

// Orderability depends on live prices and the Stripe mode: render per request.
export const dynamic = 'force-dynamic'

/** Checkout step 3 of 4: configure the order, see the server price, continue to Stripe. */
export default async function ServicePage({ params }: ServicePageProps) {
  const { gameSlug, serviceSlug } = await params
  const entry = getOfferWithTemplate(gameSlug, serviceSlug)
  if (!entry) {
    notFound()
  }

  const { game, offer, template } = entry
  const rankSystems = getRankSystemsByGame(game.slug)
  const champions = getChampions()
  const eligibility = getPurchaseStatus(offer.gameSlug, offer.serviceSlug)
  const [storefront, priceTags] = await Promise.all([
    getStorefrontService(offer.gameSlug, offer.serviceSlug),
    getPriceTags(offer.gameSlug, offer.serviceSlug),
  ])
  // Orderable only when the server would accept it: catalog eligibility AND
  // an active price (an unpriced service no longer offers a dead-end button).
  const purchase = {
    orderable: eligibility.orderable && storefront?.availability !== 'unpriced',
    testMode: eligibility.testMode,
    reason: !eligibility.orderable ? 'unavailable' : storefront?.availability === 'unpriced' ? 'unpriced' : null,
  }

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
    availabilityLabel: purchase.orderable ? offer.availabilityLabel : 'Under review',
    orderCapability: offer.orderCapability,
    complianceStatus: offer.complianceStatus,
    // Computed with the server's own eligibility rule, so the checkout
    // button matches what /api/orders will accept.
    purchase,
    fields: offer.fields,
    pricing: offer.pricing,
    // Real surcharges of extras / modes from the active admin price.
    priceTags,
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
      <main className="pb-10 pt-24 sm:pt-28">
        <CheckoutSteps current={3} gameSlug={game.slug} serviceSlug={offer.serviceSlug} />
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
