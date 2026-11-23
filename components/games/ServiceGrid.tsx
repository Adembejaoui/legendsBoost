import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import type { StorefrontService } from '@/lib/catalog/storefront-types'
import { ServiceCard } from '@/components/games/ServiceCard'
import { useTranslations } from 'next-intl'

interface ServiceGridProps {
  game: GameDefinition
  entries: { offer: GameServiceOffer; template: ServiceTemplate }[]
  storefront?: StorefrontService[]
}

export function ServiceGrid({ game, entries, storefront }: ServiceGridProps) {
  const t = useTranslations('Game')
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-[#111319]/50 py-20 text-center">
        <p className="text-sm text-zinc-500">
          {t('noServices', { name: game.name })}
        </p>
      </div>
    )
  }

  const bySlug = new Map((storefront ?? []).map((s) => [s.serviceSlug, s]))
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(({ offer, template }) => (
        <ServiceCard
          key={offer.serviceSlug}
          offer={offer}
          template={template}
          game={game}
          accent={game.accent}
          storefront={bySlug.get(offer.serviceSlug)}
        />
      ))}
    </div>
  )
}
