import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'

interface ServiceCardProps {
  offer: GameServiceOffer
  template: ServiceTemplate
  game: GameDefinition
  accent?: string
}

export function ServiceCard({
  offer,
  template,
  game,
  accent = '#8b5cf6',
}: ServiceCardProps) {
  const href = `/games/${game.slug}/services/${offer.serviceSlug}`

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-all',
        'hover:border-white/20 hover:bg-[#14161e]',
      )}
    >
      <div
        className="absolute left-0 top-0 h-1 w-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold tracking-tight text-white">
          {offer.title ?? template.title}
        </h3>
        <p className="mt-2 text-sm leading-5 text-zinc-400">
          {offer.description ?? template.description}
        </p>
        <div className="mt-auto pt-5">
          <a
            href={`/games/${game.slug}/services/${offer.serviceSlug}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-violet-300"
            aria-label={`View details for ${offer.title ?? template.title}`}
          >
            View details
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </article>
  )
}
