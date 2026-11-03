'use client'

import type { GameDefinition } from '@/types/catalog'
import type { GameServiceOffer } from '@/types/catalog'
import type { ServiceTemplate } from '@/types/catalog'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { getServiceTemplate } from '@/lib/catalog/service-templates'
import { Trophy, Target, FileText, Star, Gamepad2, Medal, ShieldCheck, User } from 'lucide-react'

interface ServicePageHeaderProps {
  game: GameDefinition
  offer: GameServiceOffer
  template: ServiceTemplate
}

const iconMap: Record<string, any> = {
  'rank-boost': Trophy,
  'win-boost': Target,
  'placement-boost': FileText,
  'arena-boost': Star,
  'normal-matches': Gamepad2,
  'champion-mastery': Medal,
  'unrated-matches': ShieldCheck,
  'double-up-boost': User,
}

export function ServicePageHeader({ game, offer, template }: ServicePageHeaderProps) {
  const title = offer.title ?? template.title
  const Icon = iconMap[offer.serviceSlug] ?? Trophy

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: 'Games', href: '/games' },
          { label: game.name, href: `/games/${game.slug}` },
          { label: title },
        ]}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          className="grid size-14 shrink-0 place-items-center rounded-full border border-white/10"
          style={{ backgroundColor: `${game.accent}22`, color: game.accent }}
          aria-hidden
        >
          <Icon className="size-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-400">
            {offer.description ?? template.description}
          </p>
        </div>
      </div>
    </div>
  )
}
