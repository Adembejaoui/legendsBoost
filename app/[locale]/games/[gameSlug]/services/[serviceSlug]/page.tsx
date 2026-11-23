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
import { getLocale, getTranslations } from 'next-intl/server'
import { catalogText, localizeField } from '@/lib/i18n/catalog'
import { getRequestCurrency } from '@/lib/currency/server'
import { languageAlternates } from '@/lib/i18n/alternates'
import { servicePath } from '@/lib/seo/short-paths'
import { breadcrumbLd, faqLd, serviceLd } from '@/lib/seo/structured-data'
import { JsonLd } from '@/components/seo/JsonLd'
import { faqFor } from '@/lib/content/faqAC'
import { formatMoney } from '@/lib/money'

interface ServicePageProps {
  params: Promise<{ gameSlug: string; serviceSlug: string }>
}

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { gameSlug, serviceSlug } = await params
  const entry = getOfferWithTemplate(gameSlug, serviceSlug)
  if (!entry) {
    return { title: (await getTranslations('Service'))('notFound') }
  }
  const locale = await getLocale()
  const ct = catalogText(locale)
  const t = await getTranslations('Seo')
  const storefront = await getStorefrontService(gameSlug, serviceSlug, await getRequestCurrency()).catch(() => null)
  const price = storefront?.availability === 'available' ? storefront.startingPrice : null
  const service = ct(entry.offer.title ?? entry.template.title)
  const description = ct(entry.offer.description ?? entry.template.description)
  const title = t('serviceTitle', { service, game: entry.game.name })
  const desc = price
    ? t('serviceDescriptionPrice', { description, price: formatMoney(price.amount, price.currency) })
    : t('serviceDescription', { description })
  return {
    title,
    description: desc,
    // One indexed address per service: the short one when it exists.
    alternates: languageAlternates(servicePath(gameSlug, serviceSlug), locale),
    openGraph: { title, description: desc, url: servicePath(gameSlug, serviceSlug) },
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
  // Shown texts in the visitor's language; keys and option values stay as they are.
  const ct = catalogText(await getLocale())
  const rankSystems = getRankSystemsByGame(game.slug)
  const champions = getChampions()
  const eligibility = getPurchaseStatus(offer.gameSlug, offer.serviceSlug)
  const currency = await getRequestCurrency()
  const [storefront, priceTags] = await Promise.all([
    getStorefrontService(offer.gameSlug, offer.serviceSlug, currency),
    getPriceTags(offer.gameSlug, offer.serviceSlug, currency),
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
    title: offer.title && ct(offer.title),
    description: offer.description && ct(offer.description),
    availability: offer.availability,
    availabilityLabel: ct(purchase.orderable ? offer.availabilityLabel : 'Under review'),
    orderCapability: offer.orderCapability,
    complianceStatus: offer.complianceStatus,
    // Computed with the server's own eligibility rule, so the checkout
    // button matches what /api/orders will accept.
    purchase,
    fields: offer.fields.map((f) => localizeField(f, ct)),
    pricing: offer.pricing,
    // Real surcharges of extras / modes from the active admin price.
    priceTags,
  }
  const templateSerializable = {
    slug: template.slug,
    title: ct(template.title),
    description: ct(template.description),
    category: template.category,
  }

  const locale = await getLocale()
  const seo = await getTranslations('Seo')
  const tService = await getTranslations('Service')
  const serviceName = ct(offer.title ?? template.title)
  const path = servicePath(game.slug, offer.serviceSlug)
  const faqs = faqFor(game.slug, offer.serviceSlug).map((f) => ({ question: ct(f.question), answer: ct(f.answer) }))

  return (
    <>
      <JsonLd
        data={[
          breadcrumbLd(
            [
              { name: seo('home'), path: '/' },
              { name: tService('games'), path: '/games' },
              { name: game.name, path: `/games/${game.slug}` },
              { name: serviceName, path },
            ],
            locale,
          ),
          serviceLd({
            name: serviceName,
            description: ct(offer.description ?? template.description),
            gameName: game.name,
            path,
            locale,
            price: storefront?.availability === 'available' ? storefront.startingPrice : null,
          }),
          faqLd(faqs),
        ]}
      />
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
