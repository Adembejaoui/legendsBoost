import type { Game } from '@/types/game'
import type { Service } from '@/types/service'
import { ServiceCard } from '@/components/game/service-card'

export function GameServiceSection({ game, services }: { game: Game; services: Service[] }) {
  return (
    <section id="services" className="scroll-mt-24 border-t border-white/[0.06] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="mb-12 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-4 text-xs font-medium uppercase tracking-[0.2em]" style={{ color: game.accent }}>
              Services
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              Available services
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
              Every service is reviewed for eligibility before publication. Only approved services are purchasable.
            </p>
          </div>
          <span className="text-sm text-zinc-500">
            {services.length} {services.length === 1 ? 'service' : 'services'} catalogued
          </span>
        </div>

        {services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[#111319]/50 py-16 text-center">
            <p className="text-sm text-zinc-500">
              No services are published for {game.name} yet. Eligible services are being reviewed and will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard
                key={service.slug}
                service={service}
                gameSlug={game.slug}
                gameName={game.name}
                accent={game.accent}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}