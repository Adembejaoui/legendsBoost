import type { Service } from '@/types/service'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ServiceSidebarProps {
  service: Service
  gameName: string
  gameAccent: string
}

export function ServiceSidebar({ service, gameName, gameAccent }: ServiceSidebarProps) {
  const Icon = service.icon

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111319]">
        <div
          className="h-1 w-full"
          style={{ backgroundColor: gameAccent }}
          aria-hidden
        />
        <div className="p-6">
          <div className="flex items-center gap-3">
            <span
              className="grid size-10 place-items-center rounded-lg"
              style={{ backgroundColor: `${gameAccent}22`, color: gameAccent }}
              aria-hidden
            >
              <Icon className="size-5" />
            </span>
            <div>
              <p className="text-xs text-zinc-500">{gameName}</p>
              <p className="text-sm font-semibold text-white">{service.category}</p>
            </div>
          </div>

          <div className="mt-6">
            {service.available ? (
              service.price !== undefined ? (
                <div>
                  <p className="text-xs text-zinc-500">{service.priceLabel ?? 'Starting at'}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-white">
                    ${service.price}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-zinc-400">Pricing pending</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    A configured price is not yet published for this service.
                  </p>
                </div>
              )
            ) : (
              <div>
                <span className="inline-flex items-center rounded-full border border-white/15 bg-black/25 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-300">
                  {service.availabilityLabel}
                </span>
                <p className="mt-3 text-sm text-zinc-500">
                  This service is under eligibility review and is not purchasable yet.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6">
            {service.available ? (
              <Button
                asChild
                className="w-full"
                style={{ backgroundColor: gameAccent }}
              >
                <a href="#request-quote">
                  Request a quote
                  <ArrowRight data-icon="inline-end" className="size-4" />
                </a>
              </Button>
            ) : (
              <Button disabled className="w-full">
                Notify me when available
              </Button>
            )}
          </div>

          <div className="mt-6 space-y-2 border-t border-white/10 pt-5 text-xs text-zinc-500">
            <p className="flex items-center gap-2">
              <Check className="size-3.5 text-emerald-400" />
              Eligibility reviewed before publication
            </p>
            <p className="flex items-center gap-2">
              <Check className="size-3.5 text-emerald-400" />
              No account passwords requested
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}