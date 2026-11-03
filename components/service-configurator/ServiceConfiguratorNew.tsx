'use client'

import type { Champion, GameServiceOffer, RankSystem } from '@/types/catalog'
import { useState } from 'react'
import { ServiceConfiguratorLayout } from '@/components/service-configurator/ServiceConfiguratorLayout'
import { ServicePageHeader } from '@/components/service-configurator/ServicePageHeader'
import { ServiceNavigationTabs } from '@/components/service-configurator/ServiceNavigationTabs'
import { RankPicker } from '@/components/service-configurator/RankSelectionCard'
import { SelectField } from '@/components/service-configurator/SelectField'
import { NumberField } from '@/components/service-configurator/NumberField'
import { CheckoutPanel } from '@/components/checkout/CheckoutPanel'
import { getRankSystem } from '@/lib/catalog/catalog-utils'
import { getOffersWithTemplate } from '@/lib/catalog/catalog-utils'
import { Image } from 'lucide-react'
import { isTargetAboveCurrent } from '@/lib/catalog/catalog-utils'

interface ServiceConfiguratorNewProps {
  game: any
  offer: GameServiceOffer
  template: any
  rankSystems: RankSystem[]
  champions: Champion[]
}

export function ServiceConfiguratorNew({ game, offer, template, rankSystems, champions }: ServiceConfiguratorNewProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const next: Record<string, unknown> = {}
    for (const field of offer.fields) {
      if ((field as any).defaultValue !== undefined) next[field.key] = (field as any).defaultValue
    }
    return next
  })

  const allOffers = getOffersWithTemplate(game.slug)

  // Determine rank fields
  const rankFields = offer.fields.filter((f) => f.type === 'rank-picker')

  // Build left content
  const leftContent: React.ReactNode[] = []

  // Add rank sections in order - try to pair current/target
  if (rankFields.length >= 2) {
    const currentField = rankFields.find((f) => f.key.toLowerCase().includes('current'))
    const targetField = rankFields.find((f) => f.key.toLowerCase().includes('target'))
    if (currentField && currentField.type === 'rank-picker') {
      const rs = getRankSystem((currentField as any).rankSystemId)
      if (rs) {
        leftContent.push(
          <RankPicker
            key={currentField.key}
            rankSystem={rs}
            value={(values[currentField.key] as any) ?? null}
            onChange={(sel) => setValues((v) => ({ ...v, [currentField.key]: sel }))}
            label="Current Rank"
            description={(currentField as any).description || 'Select your current rank and division'}
          />,
        )
      }
    }
    if (targetField && targetField.type === 'rank-picker') {
      const rs = getRankSystem((targetField as any).rankSystemId)
      if (rs) {
        leftContent.push(
          <RankPicker
            key={targetField.key}
            rankSystem={rs}
            value={(values[targetField.key] as any) ?? null}
            onChange={(sel) => setValues((v) => ({ ...v, [targetField.key]: sel }))}
            label="Desired Rank"
            description={(targetField as any).description || 'Select the rank you want to reach'}
          />,
        )
      }
    }
  } else {
    // Render each rank picker as a card
    for (const field of rankFields) {
      if (field.type === 'rank-picker') {
        const rs = getRankSystem((field as any).rankSystemId)
        if (rs) {
          leftContent.push(
            <RankPicker
              key={field.key}
              rankSystem={rs}
              value={(values[field.key] as any) ?? null}
              onChange={(sel) => setValues((v) => ({ ...v, [field.key]: sel }))}
              label={(field as any).label}
              description={(field as any).description}
            />,
          )
        }
      }
    }
  }

  // Other fields
  for (const field of offer.fields) {
    if (field.type === 'rank-picker') continue // handled above
    if (field.type === 'select') {
      leftContent.push(
        <SelectField
          key={field.key}
          label={(field as any).label}
          description={(field as any).description}
          options={(field as any).options || []}
          value={(values[field.key] as string) ?? null}
          onChange={(val) => setValues((v) => ({ ...v, [field.key]: val }))}
          required={(field as any).required}
        />,
      )
    } else if (field.type === 'number') {
      leftContent.push(
        <NumberField
          key={field.key}
          label={(field as any).label}
          description={(field as any).description}
          value={(values[field.key] as number) ?? null}
          onChange={(val) => setValues((v) => ({ ...v, [field.key]: val }))}
          min={(field as any).min}
          max={(field as any).max}
          step={(field as any).step}
          unit={(field as any).unit}
          required={(field as any).required}
        />,
      )
    }
  }

  // Validation for rank boost
  let rankError: string | null = null
  if (rankFields.length >= 2) {
    const currentField = rankFields.find((f) => f.key.toLowerCase().includes('current'))
    const targetField = rankFields.find((f) => f.key.toLowerCase().includes('target'))
    if (currentField && targetField && currentField.type === 'rank-picker' && targetField.type === 'rank-picker') {
      const current = values[currentField.key] as any
      const target = values[targetField.key] as any
      const rs = getRankSystem((currentField as any).rankSystemId)
      if (rs && current && target) {
        if (!isTargetAboveCurrent(rs.id, current, target)) {
          rankError = 'Target rank must be above your current rank.'
        }
      }
    }
  }

  const canRequest = true // allow draft creation even if pending review

  return (
    <ServiceConfiguratorLayout
      header={<ServicePageHeader game={game} offer={offer} template={template} />}
      tabs={<ServiceNavigationTabs gameSlug={game.slug} activeServiceSlug={offer.serviceSlug} offers={allOffers} />}
      left={
        <div className="space-y-6">
          {leftContent}
          {rankError ? <p className="text-xs text-rose-400">{rankError}</p> : null}
        </div>
      }
      right={
        <CheckoutPanel
          game={{ slug: game.slug, name: game.name, accent: game.accent }}
          offer={offer}
          values={values}
          rankSystems={rankSystems}
          onOrderCreated={() => {
            // Order creation is handled inside CheckoutPanel
          }}
        />
      }
    />
  )
}
