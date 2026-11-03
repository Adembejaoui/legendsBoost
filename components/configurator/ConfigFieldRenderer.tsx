'use client'

import type { Champion, ConfigField, RankSelection, RankSystem } from '@/types/catalog'
import { RankPicker } from './RankPicker'
import { SelectField } from './SelectField'
import { MultiSelectField } from './SelectField'
import { NumberField } from './NumberField'
import { CheckboxField } from './CheckboxField'
import { ChampionPicker } from './ChampionPicker'

interface ConfigFieldRendererProps {
  fields: ConfigField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  rankSystems: RankSystem[]
  champions: Champion[]
  disabled?: boolean
}

function getRankSystem(rankSystems: RankSystem[], id: string): RankSystem | undefined {
  return rankSystems.find((system) => system.id === id)
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

export function ConfigFieldRenderer({
  fields,
  values,
  onChange,
  rankSystems,
  champions,
  disabled = false,
}: ConfigFieldRendererProps) {
  const visibleFields = fields.filter((field) => isFieldVisible(field, values))

  if (visibleFields.length === 0) return null

  return (
    <div className="space-y-6">
      {visibleFields.map((field) => {
        switch (field.type) {
          case 'rank-picker': {
            const rankSystem = getRankSystem(rankSystems, field.rankSystemId)
            const currentValue = values[field.key] as RankSelection | null
            return (
              <RankPicker
                key={field.key}
                rankSystem={rankSystem!}
                value={currentValue ?? null}
                onChange={(selection) => onChange(field.key, selection ?? null)}
                label={field.label}
                required={field.required}
                disabled={disabled}
              />
            )
          }
          case 'select': {
            const currentValue = values[field.key] as string | null
            return (
              <SelectField
                key={field.key}
                label={field.label}
                description={field.description}
                options={field.options}
                value={currentValue ?? null}
                onChange={(value) => onChange(field.key, value ?? null)}
                required={field.required}
                disabled={disabled}
              />
            )
          }
          case 'multi-select': {
            const currentValue = (values[field.key] as string[]) ?? []
            return (
              <MultiSelectField
                key={field.key}
                label={field.label}
                description={field.description}
                options={field.options}
                value={currentValue}
                onChange={(value) => onChange(field.key, value)}
                required={field.required}
                disabled={disabled}
              />
            )
          }
          case 'number': {
            const currentValue = values[field.key] as number | null
            return (
              <NumberField
                key={field.key}
                label={field.label}
                description={field.description}
                value={currentValue ?? null}
                min={field.min}
                max={field.max}
                step={field.step}
                unit={field.unit}
                onChange={(value) => onChange(field.key, value ?? null)}
                required={field.required}
                disabled={disabled}
              />
            )
          }
          case 'checkbox': {
            const currentValue = values[field.key] as boolean
            return (
              <CheckboxField
                key={field.key}
                label={field.label}
                description={field.description}
                value={currentValue ?? false}
                onChange={(value) => onChange(field.key, value)}
                required={field.required}
                disabled={disabled}
              />
            )
          }
          case 'champion-picker': {
            const currentValue = values[field.key] as string | null
            return (
              <ChampionPicker
                key={field.key}
                label={field.label}
                description={field.description}
                champions={champions}
                value={currentValue ?? null}
                onChange={(value) => onChange(field.key, value ?? null)}
                required={field.required}
                disabled={disabled}
              />
            )
          }
        }
      })}
    </div>
  )
}
