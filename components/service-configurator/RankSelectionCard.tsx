'use client'

import type { RankDivision, RankSelection, RankSystem } from '@/types/catalog'
import { ImageFallback } from '@/components/ui/image-fallback'
import { cn } from '@/lib/utils'
import Image from 'next/image'

interface RankPickerProps {
  rankSystem: RankSystem
  value: RankSelection | null
  onChange: (selection: RankSelection | null) => void
  label?: string
  description?: string
  icon?: React.ReactNode
  disabled?: boolean
}

export function RankPicker({
  rankSystem,
  value,
  onChange,
  label = 'Rank',
  description,
  icon,
  disabled = false,
}: RankPickerProps) {
  const selectedTierId = value?.tierId ?? null
  const selectedDivisionId = value?.divisionId ?? null

  const tier = selectedTierId ? rankSystem.tiers.find((t) => t.id === selectedTierId) : undefined
  const divisions = tier?.divisions
  const hasDivisions = divisions && divisions.length > 0

  const selectTier = (tierId: string) => {
    const t = rankSystem.tiers.find((x) => x.id === tierId)
    if (!t) return
    if (!t.divisions || t.divisions.length === 0) {
      onChange({ tierId, divisionId: null })
      return
    }
    onChange({
      tierId,
      divisionId:
        selectedDivisionId && t.divisions.some((d) => d.id === selectedDivisionId) ? selectedDivisionId : null,
    })
  }

  const selectDivision = (divisionId: string | null) => {
    if (!selectedTierId) return
    onChange({ tierId: selectedTierId, divisionId })
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-9 place-items-center rounded-full bg-[#0b0c10] border border-white/10" aria-hidden>
          {icon}
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">{label}</h3>
          {description ? <p className="text-xs text-zinc-400">{description}</p> : null}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {rankSystem.tiers.map((t) => {
          const selected = t.id === selectedTierId
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => selectTier(t.id)}
              className={cn(
                'relative flex h-12 w-12 flex-col items-center justify-center rounded-md border transition-all',
                selected
                  ? 'border-violet-400 bg-violet-500/10 shadow-[0_0_15px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 bg-[#0b0c10] hover:border-white/20',
              )}
              aria-label={t.name}
            >
              {t.iconSrc ? (
                <Image src={t.iconSrc} alt={t.name} width={28} height={28} className="size-7 object-contain" />
              ) : (
                <ImageFallback
                  src={t.iconSrc}
                  alt={t.name}
                  className="size-7 object-contain"
                  fallback={<span className="text-xs font-semibold text-white">{t.name.charAt(0)}</span>}
                />
              )}
            </button>
          )
        })}
      </div>

      {hasDivisions && tier ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">Division</p>
          <div className="flex flex-wrap gap-2">
            {(tier.divisions ?? []).map((d) => {
              const selected = d.id === selectedDivisionId
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectDivision(d.id)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium transition-all',
                    selected
                      ? 'border-violet-400 bg-violet-500/10 text-white'
                      : 'border-white/10 bg-[#0b0c10] text-zinc-300 hover:border-white/20',
                  )}
                >
                  {d.label}
                </button>
              )
            })}
            <button
              type="button"
              disabled={disabled}
              onClick={() => selectDivision(null)}
              className="flex h-9 items-center justify-center rounded-md border border-white/10 bg-[#0b0c10] px-2 text-xs text-zinc-400 hover:border-white/20 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
