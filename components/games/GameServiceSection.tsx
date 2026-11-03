import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import { ServiceGrid } from '@/components/games/ServiceGrid'

export function GameServiceSection({
  game,
  entries,
}: {
  game: GameDefinition
  entries: { offer: GameServiceOffer; template: ServiceTemplate }[]
}) {
  return (
    <section id="services" className="scroll-mt-24 border-t border-white/[0.06] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="mb-12 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-4 text-xs font-medium uppercase tracking-[0.2em]" style={{ color: game.accent }}>
              Services
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              Services
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
              Select a service to configure your order.
            </p>
          </div>
          <span className="text-sm text-zinc-500">
            {entries.length} {entries.length === 1 ? 'service' : 'services'}
          </span>
        </div>

        <ServiceGrid game={game} entries={entries} />
      </div>
    </section>
  )
}
