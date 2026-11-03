'use client'

import type { Champion, ConfigField, GameServiceOffer, RankSelection, RankSystem } from '@/types/catalog'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfigFieldRenderer } from '../configurator/ConfigFieldRenderer'
import { ServiceSummary } from './ServiceSummary'
import {
  isTargetAboveCurrent,
} from '@/lib/catalog/catalog-utils'

interface ServiceConfiguratorProps {
  offer: GameServiceOffer
  description: string
  rankSystems: RankSystem[]
  champions: Champion[]
  disabled?: boolean
}

export function ServiceConfigurator({
  offer,
  description,
  rankSystems,
  champions,
  disabled = false,
}: ServiceConfiguratorProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const next: Record<string, unknown> = {}
    for (const field of offer.fields) {
      if (field.defaultValue !== undefined) {
        next[field.key] = field.defaultValue
      }
    }
    return next
  })

  const visibleKeys = useMemo(
    () => new Set(offer.fields.filter((field) => isFieldVisible(field, values)).map((f) => f.key)),
    [offer.fields, values],
  )

  const cleanedValues = useMemo(() => {
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(values)) {
      if (visibleKeys.has(key)) next[key] = values[key]
    }
    return next
  }, [values, visibleKeys])

  const handleFieldChange = useCallback(
    (key: string, value: unknown) => {
      setValues((current) => {
        const next = { ...current, [key]: value }
        return next
      })
    },
    [],
  )

  const rankFields = offer.fields.filter((f) => f.type === 'rank-picker')
  let rankError: string | null = null
  if (rankFields.length >= 2) {
    const currentField = rankFields.find((f) => f.key.includes('current'))
    const targetField = rankFields.find((f) => f.key.includes('target'))
    if (currentField && targetField) {
      const current = cleanedValues[currentField.key] as RankSelection | null
      const target = cleanedValues[targetField.key] as RankSelection | null
      const rankSystemId = currentField.rankSystemId ?? targetField.rankSystemId
      if (rankSystemId && current && target) {
        if (!isTargetAboveCurrent(rankSystemId, current, target)) {
          rankError = 'Target rank must be above your current rank.'
        }
      }
    }
  }

  const incompleteRequired = offer.fields.some(
    (field) =>
      field.required &&
      isFieldVisible(field, cleanedValues) &&
      !hasValue(cleanedValues[field.key]),
  )

  const formDisabled =
    disabled ||
    offer.availability !== 'available' ||
    Boolean(rankError) ||
    incompleteRequired

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-[#111319] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Service configuration</h2>
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em]',
              offer.availability === 'available'
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-400'
                : 'border-white/15 bg-black/25 text-zinc-300',
            )}
          >
            {offer.availabilityLabel ?? offer.availability}
          </span>
        </div>
        <p className="text-sm text-zinc-400">{description}</p>

        <ConfigFieldRenderer
          fields={offer.fields}
          values={cleanedValues}
          onChange={handleFieldChange}
          rankSystems={rankSystems}
          champions={champions}
          disabled={formDisabled}
        />

        {rankError && <p className="mt-2 text-xs text-rose-400">{rankError}</p>}

        {offer.fields.length > 0 && (
          <ServiceSummary values={cleanedValues} offer={offer} rankSystems={rankSystems} />
        )}
      </div>

      {offer.fields.length > 0 && (
        <p className="text-xs text-zinc-500">
          {offer.availability !== 'available'
            ? 'This service is under review and cannot be ordered yet. No account credentials are collected.'
            : rankError
              ? 'Fix the configuration errors above before continuing.'
              : incompleteRequired
                ? 'Complete the required fields above before continuing.'
                : null}
        </p>
      )}

      <div className="pt-2">
        <Button
          disabled={formDisabled}
          onClick={() => {
            if (!formDisabled) {
              // No ordering flow is connected in this release. This is where a
              // verified, permitted service would hand off to checkout.
              alert(
                'No payment or ordering flow is connected in this release.\n\n' +
                  'Configuration summary:\n' +
                  JSON.stringify(values, null, 2),
              )
            }
          }}
          className="w-full"
        >
          {offer.availability !== 'available'
            ? 'Notify me when available'
            : rankError || incompleteRequired
              ? 'Fix configuration to continue'
              : 'Request a quote'}
        </Button>
        <p className="mt-3 text-xs text-zinc-600">
          No account credentials are requested or stored. Eligibility reviewed before publication.
        </p>
      </div>
    </section>
  )
}

function isFieldVisible(field: ConfigField, values: Record<string, unknown>): boolean {
  const conditions = Array.isArray(field.visibleWhen)
    ? field.visibleWhen
    : field.visibleWhen
      ? [field.visibleWhen]
      : []

  return conditions.every((condition) => {
    const current = values[condition.key]
    switch (condition.operator ?? 'equals') {
      case 'present':
        return current !== null && current !== undefined && current !== ''
      case 'absent':
        return current === null || current === undefined || current === ''
      case 'equals':
      default:
        return current === condition.value
    }
  })
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return String(value) !== ''
}
