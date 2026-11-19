'use client'

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
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
  /** Shown inside the card under the list (e.g. the Server dropdown). */
  children?: React.ReactNode
}

function Portrait({ champion, className }: { champion: Champion; className?: string }) {
  return (
    <ImageFallback
      src={champion.iconSrc}
      alt=""
      className={cn('shrink-0 rounded-lg object-cover', className)}
      fallback={
        <span className={cn('grid shrink-0 place-items-center rounded-lg border border-white/10 bg-[#0b0c10] text-xs font-semibold text-white', className)}>
          {champion.name.charAt(0).toUpperCase()}
        </span>
      }
    />
  )
}

/**
 * Champion card (client PDFs 2026-11-19): the chosen champion's portrait,
 * a search box and every champion in a scrollable grid.
 */
export function ChampionPicker({ label, description, champions, value, onChange, required, disabled = false, children }: ChampionPickerProps) {
  const [query, setQuery] = useState('')
  const selected = champions.find((c) => c.id === value) ?? null
  const sorted = useMemo(() => [...champions].sort((a, b) => a.name.localeCompare(b.name)), [champions])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sorted.filter((c) => c.name.toLowerCase().includes(q)) : sorted
  }, [sorted, query])

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
      <div className="mb-3 flex items-center gap-3">
        {selected ? (
          <Portrait champion={selected} className="size-11 ring-2 ring-violet-400/60" />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-zinc-500">?</span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1 text-base font-semibold text-white">
            {label}
            {required ? <span className="text-rose-400">*</span> : null}
          </h3>
          <p className="truncate text-xs text-zinc-400">{selected ? `${selected.name}${selected.title ? `, ${selected.title}` : ''}` : description}</p>
        </div>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a champion…"
          aria-label="Search a champion"
          disabled={disabled}
          className="h-9 w-full rounded-md border border-white/10 bg-[#0b0c10] pl-8 pr-8 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-violet-400/60"
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-white">
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div
        role="listbox"
        aria-label={label}
        className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 p-1.5 sm:grid-cols-6 lg:grid-cols-7"
      >
        {shown.length === 0 ? (
          <p className="col-span-full py-6 text-center text-sm text-zinc-500">No champion matches “{query}”.</p>
        ) : (
          shown.map((champion) => {
            const isSelected = champion.id === value
            return (
              <button
                key={champion.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                onClick={() => onChange(isSelected ? null : champion.id)}
                title={champion.name}
                className={cn(
                  'relative flex min-w-0 flex-col items-center gap-1 rounded-md border p-1.5 text-[11px] transition-colors',
                  isSelected
                    ? 'border-violet-400 bg-violet-500/15 text-white'
                    : 'border-transparent text-zinc-400 hover:border-white/15 hover:bg-white/[0.04] hover:text-zinc-100',
                )}
              >
                <Portrait champion={champion} className="size-10" />
                <span className="w-full truncate text-center">{champion.name}</span>
                {isSelected ? (
                  <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-violet-500 text-white">
                    <Check className="size-3" />
                  </span>
                ) : null}
              </button>
            )
          })
        )}
      </div>

      {children ? <div className="mt-3 border-t border-white/10 pt-3">{children}</div> : null}
    </div>
  )
}
