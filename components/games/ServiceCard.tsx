import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { AVAILABILITY_LABEL, type StorefrontService } from '@/lib/catalog/storefront-types'
import { ArrowRight } from 'lucide-react'
import { Link } from "@/i18n/navigation";
import { useTranslations } from 'next-intl'
import { useCatalogText } from '@/lib/i18n/catalog'
import { servicePath } from '@/lib/seo/short-paths'

interface ServiceCardProps {
  offer: GameServiceOffer
  template: ServiceTemplate
  game: GameDefinition
  accent?: string
  /** Live status and starting price (server-computed). */
  storefront?: StorefrontService
}

/**
 * Checkout step 2 card. The whole card selects the service (client-side
 * navigation to step 3). Services that cannot be bought right now stay
 * visible with their status, but are not a dead-end link.
 */
export function ServiceCard({ offer, template, game, accent = '#8b5cf6', storefront }: ServiceCardProps) {
  const t = useTranslations('Game')
  const ct = useCatalogText()
  const title = offer.title ?? template.title
  const availability = storefront?.availability ?? 'unknown'
  const selectable = availability === 'available' || availability === 'unknown'
  const price = storefront?.startingPrice
  const body = (
    <>
      <div className="absolute start-0 top-0 h-1 w-full" style={{ backgroundColor: accent }} aria-hidden />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]',
              availability === 'available' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-zinc-400',
            )}
          >
            {ct(AVAILABILITY_LABEL[availability])}
          </span>
        </div>
        <p className="mt-2 text-sm leading-5 text-zinc-400">{offer.description ?? template.description}</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <span className="text-sm text-zinc-300">
            {price ? (
              <>
                <span className="text-xs text-zinc-500">{t('from')} </span>
                <span className="font-semibold text-white">{formatMoney(price.amount, price.currency)}</span>
              </>
            ) : null}
          </span>
          {selectable ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white transition-colors group-hover:text-orange-300">
              {t('select')}
              <ArrowRight className="size-4" aria-hidden />
            </span>
          ) : null}
        </div>
      </div>
    </>
  )
  const base = 'group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-all'
  if (!selectable) {
    return <article className={cn(base, 'opacity-60')} aria-disabled="true">{body}</article>
  }
  return (
    <Link
      href={servicePath(game.slug, offer.serviceSlug)}
      className={cn(base, 'hover:border-white/25 hover:bg-[#14161e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400')}
      aria-label={price ? t('selectAriaPrice', { title, price: formatMoney(price.amount, price.currency) }) : t('selectAria', { title })}
    >
      {body}
    </Link>
  )
}
