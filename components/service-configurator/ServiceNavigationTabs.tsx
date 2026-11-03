'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { OfferWithTemplate } from '@/lib/catalog/catalog-utils'

interface ServiceNavigationTabsProps {
  gameSlug: string
  activeServiceSlug: string
  offers: OfferWithTemplate[]
}

export function ServiceNavigationTabs({ gameSlug, activeServiceSlug, offers }: ServiceNavigationTabsProps) {
  if (offers.length === 0) return null

  return (
    <nav aria-label="Service tabs" className="overflow-x-auto">
      <ul className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#111319] p-1">
        {offers.map((entry) => {
          const slug = entry.offer.serviceSlug
          const isActive = slug === activeServiceSlug
          const href = `/games/${gameSlug}/services/${slug}`
          const title = entry.offer.title ?? entry.template.title
          return (
            <li key={slug} className="shrink-0">
              <Link
                href={href}
                className={cn(
                  'inline-flex items-center rounded-md px-3 py-1.5 text-sm transition-all',
                  isActive
                    ? 'bg-violet-500/20 text-white shadow-[0_0_0_1px_rgba(139,92,246,0.5)]'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5',
                )}
              >
                {title}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
