'use client'

import type { Champion } from '@/types/catalog'
import { ImageFallback } from '@/components/ui/image-fallback'
import { cn } from '@/lib/utils'

interface ChampionPickerProps {
  label: string
  description?: string
  champions: Champion[]
  value: string | null
  onChange: (championId: string | null) => void
  required?: boolean
  disabled?: boolean
}

export function ChampionPicker({
  label,
  description,
  champions,
  value,
  onChange,
  required,
  disabled = false,
}: ChampionPickerProps) {
  const isSelected = (id: string) => value === id

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-white">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </label>
      {description && (
        <p className="text-xs text-zinc-500">{description}</p>
      )}
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {champions.map((champion) => {
          const selected = isSelected(champion.id)
          return (
            <button
              key={champion.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(selected ? null : champion.id)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-all',
                selected
                  ? 'border-violet-400 bg-violet-500/10 text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 bg-[#111319] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
              )}
            >
              <ImageFallback
                src={champion.iconSrc}
                alt={champion.name}
                className="size-8 shrink-0 rounded-lg"
                fallback={
                  <span className="size-8 rounded-lg flex items-center justify-center border border-white/10 bg-[#0b0c10] text-xs font-semibold text-white">
                    {champion.name.charAt(0).toUpperCase()}
                  </span>
                }
              />
              <span>{champion.name}</span>
            </button>
          )
        })}
      </div>
      {required && !value && (
        <p className="text-xs text-rose-400">This field is required.</p>
      )}
    </div>
  )
}
