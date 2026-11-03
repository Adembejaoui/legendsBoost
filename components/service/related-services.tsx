import type { Service } from '@/types/service'
import type { Game } from '@/types/game'
import { ArrowRight } from 'lucide-react'
import { ServiceCard } from '@/components/game/service-card'

export function RelatedServices({ services, gameSlug, gameName, gameAccent }: { services: Service[]; gameSlug: string; gameName: string; gameAccent: string }) {
  if (services.length === 0) return null

  return (
    <section className="border-t border-white/[0.06] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
              Related services
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">
              More in {gameName}
            </h2>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <ServiceCard
              key={service.slug}
              service={service}
              gameSlug={gameSlug}
              gameName={gameName}
              accent={gameAccent}
            />
          ))}
        </div>
      </div>
    </section>
  )
}