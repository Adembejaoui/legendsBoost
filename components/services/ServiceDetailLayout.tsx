import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import { type ReactNode } from 'react'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import Link from 'next/link'
import { getOffersWithTemplate } from '@/lib/catalog/catalog-utils'

interface ServiceDetailLayoutProps {
  game: GameDefinition
  offer: GameServiceOffer
  template: ServiceTemplate
  children: ReactNode
}

export function ServiceDetailLayout({
  game,
  offer,
  template,
  children,
}: ServiceDetailLayoutProps) {
  const related = getOffersWithTemplate(game.slug).filter(
    (entry) => entry.offer.serviceSlug !== offer.serviceSlug,
  )

  return (
    <>
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <Breadcrumb
          items={[
            { label: 'Games', href: '/games' },
            { label: game.name, href: `/games/${game.slug}` },
            { label: offer.title ?? template.title },
          ]}
        />
      </div>

      <section className="relative overflow-hidden pt-10 pb-16 sm:pt-14 sm:pb-20">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(circle at 70% 20%, ${game.accent}22, transparent 40%)`,
          }}
          aria-hidden
        />
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-8">
            <div className="flex flex-col gap-3">
              <span
                className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em]"
                style={{
                  borderColor: `${game.accent}40`,
                  color: game.accent,
                  backgroundColor: `${game.accent}15`,
                }}
              >
                {template.icon ? <template.icon className="size-3.5" /> : null}
                {template.category}
              </span>
              <h1 className="text-4xl font-semibold leading-[0.98] tracking-[-0.05em] text-white sm:text-6xl lg:text-[4.5rem]">
                {offer.title ?? template.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                {offer.description ?? template.description}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: game.accent }} />
                  {game.name}
                </span>
                <span
                  className={[
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] backdrop-blur',
                    offer.availability === 'available'
                      ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-400'
                      : 'border-white/15 bg-black/25 text-zinc-300',
                  ].join(' ')}
                >
                  {offer.availabilityLabel ?? offer.availability}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.6fr_0.8fr] lg:items-start">
          <div>{children}</div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111319]">
              <div
                className="h-1 w-full"
                style={{ backgroundColor: game.accent }}
                aria-hidden
              />
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <span
                    className="grid size-10 place-items-center rounded-lg"
                    style={{ backgroundColor: `${game.accent}22`, color: game.accent }}
                    aria-hidden
                  >
                    {template.icon ? <template.icon className="size-5" /> : null}
                  </span>
                  <div>
                    <p className="text-xs text-zinc-500">{game.name}</p>
                    <p className="text-sm font-semibold text-white">{template.category}</p>
                  </div>
                </div>
                <p className="text-sm text-zinc-500 mb-6">
                  Configure the service details below to see a summary of your selection.
                </p>
                <p className="text-xs text-zinc-600">
                  No account credentials are requested or stored.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {related.length > 0 && (
        <section className="border-t border-white/[0.06] py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="mb-10 flex items-center justify-between">
              <div>
                <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
                  Related services
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">
                  More in {game.name}
                </h2>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((entry) => (
                <ServiceCardLite
                  key={entry.offer.serviceSlug}
                  game={game}
                  offer={entry.offer}
                  template={entry.template}
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  )
}

function ServiceCardLite({
  game,
  offer,
  template,
}: {
  game: GameDefinition
  offer: GameServiceOffer
  template: ServiceTemplate
}) {
  const href = `/games/${game.slug}/services/${offer.serviceSlug}`
  const orderable = offer.availability === 'available'
  const Icon = offer.icon ?? template.icon

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319]">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: `${game.accent}22`, color: game.accent }}
            aria-hidden
          >
            {Icon ? <Icon className="size-5" /> : <span className="size-5">{template.title.charAt(0)}</span>}
          </span>
          <span
            className={[
              'rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]',
              orderable
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-400'
                : 'border-white/15 bg-black/25 text-zinc-300',
            ].join(' ')}
          >
            {offer.availabilityLabel ?? offer.availability}
          </span>
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">
          {offer.title ?? template.title}
        </h3>
        <p className="mt-2 text-sm leading-5 text-zinc-400">
          {offer.description ?? template.description}
        </p>
        <div className="mt-auto pt-5">
          {orderable ? (
            <Link
              href={href}
              className="inline-flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-violet-300"
            >
              View details
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
