import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { FaqSection, FinalCta, GameShowcase, HeroSection, HowItWorks, TrustSection } from '@/components/home/sections'

export default function Page() {
  return <>
          <SiteHeader />
          <main>
            <HeroSection />
            <GameShowcase />
            <HowItWorks />
            <TrustSection />
            <FaqSection />
            <FinalCta />
          </main>
          <SiteFooter />
        </>
}