import { ArrowRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getOfferWithTemplate } from '@/lib/catalog/catalog-utils'
import { getStorefrontService } from '@/lib/catalog/storefront'
import { getRequestCurrency } from '@/lib/currency/server'
import { catalogText } from '@/lib/i18n/catalog'
import { formatMoney } from '@/lib/money'
import { servicePath } from '@/lib/seo/short-paths'

/** Order box inside a post: the service, its live starting price and an order button. */
export async function ServiceEmbed({ gameSlug, serviceSlug }: { gameSlug: string; serviceSlug: string }) {
  const entry = getOfferWithTemplate(gameSlug, serviceSlug)
  if (!entry) return null
  const [t, ct, currency] = await Promise.all([getTranslations('Blog'), getLocale().then(catalogText), getRequestCurrency()])
  const storefront = await getStorefrontService(gameSlug, serviceSlug, currency).catch(() => null)
  const price = storefront?.availability === 'available' ? storefront.startingPrice : null
  const title = ct(entry.offer.title ?? entry.template.title)
  return (
    <aside
      className="not-prose my-8 flex flex-col gap-4 rounded-xl border border-violet-400/25 bg-gradient-to-br from-[#1d1634] to-[#12131a] p-5 sm:flex-row sm:items-center sm:justify-between"
      aria-label={title}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-violet-300">{entry.game.name}</p>
        <p className="mt-1 text-lg font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-zinc-400">{ct(entry.offer.description ?? entry.template.description)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {price ? (
          <p className="text-end">
            <span className="block text-[11px] text-zinc-500">{t('from')}</span>
            <span className="text-xl font-bold text-white">{formatMoney(price.amount, price.currency)}</span>
          </p>
        ) : null}
        <Link
          href={servicePath(gameSlug, serviceSlug)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-400"
        >
          {t('order')}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </aside>
  )
}
