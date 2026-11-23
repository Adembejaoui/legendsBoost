import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { FaqSection, FinalCta, GameShowcase, HeroSection, HowItWorks, TrustSection } from '@/components/home/sections'
import { JsonLd } from '@/components/seo/JsonLd'
import { games } from '@/lib/games'
import { getGamePurchaseLabel } from '@/lib/orders/order-eligibility'
import { languageAlternates } from '@/lib/i18n/alternates'
import { routing, type Locale } from '@/i18n/routing'
import { organizationLd, websiteLd } from '@/lib/seo/structured-data'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  return { alternates: languageAlternates('/', locale) }
}

export default async function Page({ params }: { params: Params }) {
  const raw = (await params).locale
  const locale: Locale = (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'Site' })
  return <>
          <JsonLd data={[organizationLd(t('description')), websiteLd(locale)]} />
          <SiteHeader />
          <main>
            <HeroSection />
            <GameShowcase labels={Object.fromEntries(games.map((g) => [g.slug, getGamePurchaseLabel(g.slug)]))} />
            <HowItWorks />
            <TrustSection />
            <FaqSection />
            <FinalCta />
          </main>
          <SiteFooter />
        </>
}
