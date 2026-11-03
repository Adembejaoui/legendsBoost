import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import { ServiceCard } from '@/components/games/ServiceCard'

interface ServiceGridProps {
  game: GameDefinition
  entries: { offer: GameServiceOffer; template: ServiceTemplate }[]
}

export function ServiceGrid({ game, entries }: ServiceGridProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-[#111319]/50 py-20 text-center">
        <p className="text-sm text-zinc-500">
          No services are available for {game.name}.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(({ offer, template }) => (
        <ServiceCard
          key={offer.serviceSlug}
          offer={offer}
          template={template}
          game={game}
          accent={game.accent}
        />
      ))}
    </div>
  )
}
