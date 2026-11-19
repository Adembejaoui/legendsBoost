'use client'

import type { Champion, GameServiceOffer, RankSystem } from '@/types/catalog'
import { useEffect, useRef, useState } from 'react'
import { patchCheckout, readCheckout } from '@/lib/checkout/session-state'
import { ServiceConfiguratorLayout } from '@/components/service-configurator/ServiceConfiguratorLayout'
import { ServicePageHeader } from '@/components/service-configurator/ServicePageHeader'
import { ServiceNavigationTabs } from '@/components/service-configurator/ServiceNavigationTabs'
import { RankPicker } from '@/components/service-configurator/RankSelectionCard'
import { InlineSelectField, SelectField } from '@/components/service-configurator/SelectField'
import { NumberField } from '@/components/service-configurator/NumberField'
import { CheckoutPanel } from '@/components/checkout/CheckoutPanel'
import { ServiceFaq } from '@/components/service-configurator/ServiceFaq'
import { faqFor } from '@/lib/content/faqAC'
import { ChampionPicker } from '@/components/configurator/ChampionPicker'
import { MultiSelectField } from '@/components/configurator/SelectField'
import { CheckboxField } from '@/components/configurator/CheckboxField'
import { getRankSystem } from '@/lib/catalog/catalog-utils'
import { getOffersWithTemplate } from '@/lib/catalog/catalog-utils'
import { Image } from 'lucide-react'
import { isTargetAboveCurrent } from '@/lib/catalog/catalog-utils'

/** Fields shown side by side in the current-rank box. */
const INLINE_FIELD_KEYS = new Set(['currentLp', 'lpGain', 'server', 'queueType', 'gameMode'])
/** Static class names (Tailwind) for 2, 3 or 4 columns from the small breakpoint. */
const INLINE_COLS: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }

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

  // Keep the configuration when the customer goes back (step indicator,
  // browser back, Stripe's back link, sign-in round trip). Restored after
  // hydration because the server cannot read sessionStorage; only keys that
  // are fields of this service are accepted (the server re-validates anyway).
  const restored = useRef(false)
  useEffect(() => {
    const saved = readCheckout(game.slug, offer.serviceSlug).values
    if (saved && typeof saved === 'object') {
      const keys = new Set(offer.fields.map((f) => f.key))
      const clean = Object.fromEntries(Object.entries(saved).filter(([k]) => keys.has(k)))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from sessionStorage after hydration
      if (Object.keys(clean).length) setValues((v) => ({ ...v, ...clean }))
    }
    restored.current = true
  }, [game.slug, offer.serviceSlug, offer.fields])
  useEffect(() => {
    if (restored.current) patchCheckout(game.slug, offer.serviceSlug, { values })
  }, [game.slug, offer.serviceSlug, values])

  const allOffers = getOffersWithTemplate(game.slug)

  // Determine rank fields
  const rankFields = offer.fields.filter((f) => f.type === 'rank-picker')

  // Small dropdowns shown side by side inside the current-rank box, in the
  // catalog order (client PDFs 2026-11-19). Only when that box exists.
  const hasCurrentRank = rankFields.some((f) => f.key === 'currentRank')
  const hasChampionCard = offer.fields.some((f) => f.type === 'champion-picker')
  const inlineFields =
    hasCurrentRank || hasChampionCard ? offer.fields.filter((f) => f.type === 'select' && INLINE_FIELD_KEYS.has(f.key)) : []
  const inlineKeys = new Set(inlineFields.map((f) => f.key))
  const inlineRow =
    inlineFields.length > 0 ? (
      <div className={`grid grid-cols-2 gap-3 ${INLINE_COLS[Math.min(inlineFields.length, 4)]}`}>
        {inlineFields.map((field) => (
          <InlineSelectField
            key={field.key}
            label={(field as any).label}
            description={(field as any).description}
            options={(field as any).options || []}
            value={(values[field.key] as string) ?? null}
            onChange={(val) => setValues((v) => ({ ...v, [field.key]: val }))}
            required={(field as any).required}
          />
        ))}
      </div>
    ) : null

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
          >
            {currentField.key === 'currentRank' ? inlineRow : null}
          </RankPicker>,
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
            >
              {field.key === 'currentRank' ? inlineRow : null}
            </RankPicker>,
          )
        }
      }
    }
  }

  // Other fields
  const renderedGroups = new Set<string>()
  for (const field of offer.fields) {
    if (field.type === 'rank-picker') continue // handled above
    if (inlineKeys.has(field.key)) continue // in the current-rank box
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
      const numberField = (bare: boolean, nf: typeof field) => (
        <NumberField
          key={nf.key}
          label={nf.label}
          description={nf.description}
          value={(values[nf.key] as number) ?? null}
          onChange={(val) => setValues((v) => ({ ...v, [nf.key]: val }))}
          min={nf.min}
          max={nf.max}
          step={nf.step}
          unit={nf.unit}
          required={nf.required}
          display={nf.display}
          optionLabel={nf.optionLabel}
          bare={bare}
        />
      )
      if (field.group) {
        // One box per group, rendered at its first field.
        if (renderedGroups.has(field.group)) continue
        renderedGroups.add(field.group)
        const members = offer.fields.filter((x): x is typeof field => x.type === 'number' && x.group === field.group)
        leftContent.push(
          <div key={`group-${field.group}`} className="rounded-xl border border-white/10 bg-[#111319] p-4">
            <h3 className="mb-3 text-base font-semibold text-white">{field.group}</h3>
            <div className="grid grid-cols-2 gap-3">{members.map((m) => numberField(true, m))}</div>
          </div>,
        )
      } else {
        leftContent.push(numberField(false, field))
      }
    } else if (field.type === 'champion-picker') {
      // Champion Mastery's required champion: without this picker the
      // field could never be filled and the service could never be ordered.
      leftContent.push(
        <ChampionPicker
          key={field.key}
          label={field.label}
          description={field.description}
          champions={champions}
          value={(values[field.key] as string) ?? null}
          onChange={(val) => setValues((v) => ({ ...v, [field.key]: val }))}
          required={field.required}
        >
          {inlineRow}
        </ChampionPicker>,
      )
    } else if (field.type === 'multi-select') {
      leftContent.push(
        <MultiSelectField
          key={field.key}
          label={field.label}
          description={field.description}
          options={field.options}
          value={(values[field.key] as string[]) ?? []}
          onChange={(val) => setValues((v) => ({ ...v, [field.key]: val }))}
          required={field.required}
        />,
      )
    } else if (field.type === 'checkbox') {
      leftContent.push(
        <CheckboxField
          key={field.key}
          label={field.label}
          description={field.description}
          value={(values[field.key] as boolean) ?? false}
          onChange={(val) => setValues((v) => ({ ...v, [field.key]: val }))}
          required={field.required}
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

  if (typeof values.currentLevel === 'number' && typeof values.targetLevel === 'number' && values.targetLevel <= values.currentLevel) {
    rankError = 'Desired mastery must be above your current mastery.'
  }

  const canRequest = true // allow draft creation even if pending review

  return (
    <ServiceConfiguratorLayout
      header={<ServicePageHeader game={game} offer={offer} template={template} />}
      tabs={<ServiceNavigationTabs gameSlug={game.slug} activeServiceSlug={offer.serviceSlug} offers={allOffers} />}
      left={
        <div className="space-y-3">
          {leftContent}
          {rankError ? <p className="text-xs text-rose-400">{rankError}</p> : null}
        </div>
      }
      footer={<ServiceFaq title={offer.title ?? template.title} items={faqFor(game.slug, offer.serviceSlug)} />}
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
