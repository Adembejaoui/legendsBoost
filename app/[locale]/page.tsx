import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { FaqSection, FinalCta, GameShowcase, HeroSection, HowItWorks, TrustSection } from '@/components/home/sections'
import { games } from '@/lib/games'
import { getGamePurchaseLabel } from '@/lib/orders/order-eligibility'

export default function Page() {
  return <>
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