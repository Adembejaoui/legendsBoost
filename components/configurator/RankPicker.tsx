'use client'

import { useEffect, useState } from 'react'
import type { RankSelection, RankSystem } from '@/types/catalog'
import { ImageFallback } from '@/components/ui/image-fallback'
import { DivisionPicker } from './DivisionPicker'
import { cn } from '@/lib/utils'
import Image from 'next/image'

interface RankPickerProps {
  rankSystem: RankSystem
  value: RankSelection | null
  onChange: (selection: RankSelection | null) => void
  label?: string
  name?: string
  required?: boolean
  disabled?: boolean
}

export function RankPicker({
  rankSystem,
  value,
  onChange,
  label,
  name,
  required,
  disabled = false,
}: RankPickerProps) {
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null)

  useEffect(() => {
    if (value) {
      setSelectedTierId(value.tierId)
      const tier = rankSystem.tiers.find((t) => t.id === value.tierId)
      const divisionValid = value.divisionId
        ? tier?.divisions?.some((d) => d.id === value.divisionId) ?? false
        : true
      setSelectedDivisionId(divisionValid ? value.divisionId : null)
    } else {
      setSelectedTierId(null)
      setSelectedDivisionId(null)
    }
  }, [value, rankSystem])

  const tier = selectedTierId ? rankSystem.tiers.find((t) => t.id === selectedTierId) : undefined
  const divisions = tier?.divisions

  const hasDivisions = divisions && divisions.length > 0

  const isTierSelected = (id: string) => id === selectedTierId
  const isDivisionSelected = (id: string) => id === selectedDivisionId

  const selectTier = (id: string) => {
    setSelectedTierId(id)
    if (!divisions || divisions.length === 0) {
      setSelectedDivisionId(null)
      onChange({ tierId: id, divisionId: null })
      return
    }
    const currentValid = selectedDivisionId
      ? divisions.some((d) => d.id === selectedDivisionId)
      : false
    const divisionId = currentValid ? selectedDivisionId : null
    setSelectedDivisionId(divisionId)
    onChange({ tierId: id, divisionId })
  }

  const selectDivision = (id: string | null) => {
    setSelectedDivisionId(id)
    onChange(selectedTierId ? { tierId: selectedTierId, divisionId: id } : null)
  }

  return (
    <div
      role="group"
      aria-label={label ?? rankSystem.name}
      className="space-y-4"
    >
      {label && (
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-[0.16em]">
          {label}
        </span>
      )}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rankSystem.tiers.map((tier) => {
          const selected = isTierSelected(tier.id)
          return (
            <button
              key={tier.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => selectTier(tier.id)}
              className={cn(
                'flex flex-col items-center justify-between gap-2 rounded-lg border p-3 text-center transition-all',
                selected
                  ? 'border-violet-400 bg-violet-500/10 shadow-[0_0_20px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 hover:border-white/20 hover:bg-[#14161e] text-zinc-300',
              )}
            >
              {tier.iconSrc ? (
                <Image
                  src={tier.iconSrc}
                  alt={tier.name}
                  width={32}
                  height={32}
                  className="size-8 shrink-0 object-contain"
                />
              ) : (
                <ImageFallback
                  src={tier.iconSrc}
                  alt={tier.name}
                  className="size-8 shrink-0 object-contain"
                  fallback={
                    <span className="size-8 rounded-lg flex items-center justify-center border border-white/10 bg-[#0b0c10] text-xs font-semibold text-white">
                      {tier.name.charAt(0)}
                    </span>
                  }
                />
              )}
              <span className="text-sm font-semibold text-white">{tier.name}</span>
              {hasDivisions && tier.divisions ? (
                <span className="mt-0.5 text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
                  {tier.divisions.length} div.
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {hasDivisions && tier ? (
        <DivisionPicker
          divisions={tier.divisions ?? []}
          value={selectedDivisionId}
          onChange={selectDivision}
          disabled={disabled}
        />
      ) : null}

      {(selectedTierId || selectedDivisionId) && !disabled && (
        <p className="text-xs text-zinc-500">
          Selected: {formatSelectionDisplay(rankSystem, selectedTierId, selectedDivisionId)}
        </p>
      )}

      {required && !value ? (
        <p className="text-xs text-rose-400">This field is required.</p>
      ) : null}
    </div>
  )
}

function formatSelectionDisplay(
  rankSystem: RankSystem,
  tierId: string | null,
  divisionId: string | null,
): string {
  if (!tierId) return 'Not selected'
  const tier = rankSystem.tiers.find((t) => t.id === tierId)
  const division = divisionId ? tier?.divisions?.find((d) => d.id === divisionId) : undefined
  return [tier?.name ?? tierId, division?.label].filter(Boolean).join(' ')
}
