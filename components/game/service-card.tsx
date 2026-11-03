import type { Service } from '@/types/service'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface ServiceCardProps {
  service: Service
  gameSlug: string
  gameName: string
  accent?: string
  priority?: boolean
}

export function ServiceCard({ service, gameSlug, gameName, accent = '#8b5cf6', priority = false }: ServiceCardProps) {
  const href = `/games/${gameSlug}/services/${service.slug}`
  const Icon = service.icon

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-all',
        'hover:border-white/20 hover:bg-[#14161e]',
        'focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-400/40',
      )}
    >
      <div
        className="absolute left-0 top-0 h-1 w-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: `${accent}22`, color: accent }}
            aria-hidden
          >
            <Icon className="size-5" />
          </span>
          <span className="mt-1 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-300">
            {service.availabilityLabel}
          </span>
        </div>

        <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">
          {service.title}
        </h3>
        <p className="mt-2 text-sm leading-5 text-zinc-400">
          {service.shortDescription}
        </p>

        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-md bg-white/5 px-2 py-1">{service.category}</span>
          <span className="text-zinc-600">{gameName}</span>
        </div>

        <div className="mt-auto pt-5">
          {service.available ? (
            <Link
              href={href}
              className="inline-flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-violet-300"
            >
              View details
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500">
              Under review
            </span>
          )}
        </div>
      </div>
    </article>
  )
}