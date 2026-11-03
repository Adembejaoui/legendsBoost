'use client'

import type { ConfigOption } from '@/types/catalog'
import { cn } from '@/lib/utils'

interface ServiceOptionRowProps {
  label: string
  description?: string
  badge?: string
  price?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}

export function ServiceOptionRow({
  label,
  description,
  badge,
  price,
  checked = false,
  onChange,
  disabled = false,
}: ServiceOptionRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-[#0b0c10] p-3">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white">{label}</p>
          {badge ? (
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? <p className="mt-1 text-xs text-zinc-500">{description}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        {price ? <span className="text-sm text-zinc-300">{price}</span> : null}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange?.(!checked)}
          className={cn(
            'relative inline-flex h-6 w-10 items-center rounded-full border transition-all',
            checked ? 'border-violet-400 bg-violet-500/30' : 'border-white/10 bg-[#111319]',
            disabled ? 'opacity-50' : '',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              checked ? 'translate-x-5' : 'translate-x-1',
            )}
          />
        </button>
      </div>
    </div>
  )
}
