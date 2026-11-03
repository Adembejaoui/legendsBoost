'use client'

import type { RankDivision } from '@/types/catalog'
import { cn } from '@/lib/utils'

interface DivisionPickerProps {
  divisions: RankDivision[]
  value: string | null
  onChange: (divisionId: string | null) => void
  disabled?: boolean
}

export function DivisionPicker({
  divisions,
  value,
  onChange,
  disabled = false,
}: DivisionPickerProps) {
  if (!divisions || divisions.length === 0) return null

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-zinc-400 uppercase tracking-[0.16em]">
        Division
      </span>
      <div
        role="radiogroup"
        aria-label="Division"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {divisions.map((division) => {
          const selected = value === division.id
          return (
            <button
              key={division.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(division.id)}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-all',
                selected
                  ? 'border-violet-400 bg-violet-500/10 text-white shadow-[0_0_15px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 bg-[#111319] text-zinc-300 hover:border-white/20 hover:text-white',
              )}
            >
              <span>{division.label}</span>
              {division.iconSrc ? (
                <span className="ml-2 shrink-0">{division.label.charAt(0)}</span>
              ) : null}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        className="mt-1 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
      >
        Clear division
      </button>
    </div>
  )
}
