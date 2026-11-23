'use client'

import { cn } from '@/lib/utils'
import type { CheckoutMode } from '@/lib/config/checkout-options'

interface CheckoutModeSelectorProps {
  modes: { id: CheckoutMode; label: string; enabled: boolean }[]
  value: CheckoutMode
  onChange: (mode: CheckoutMode) => void
  /** Real surcharge per mode ("+40%"); empty for an included mode. */
  tags?: Record<string, string>
}

export function CheckoutModeSelector({ modes, value, onChange, tags }: CheckoutModeSelectorProps) {
  if (!modes || modes.length === 0) return null

  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Session type</p>
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0b0c10] p-1">
        {modes
          .filter((m) => m.enabled)
          .map((mode) => {
            const active = mode.id === value
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChange(mode.id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm transition-all',
                  active ? 'bg-violet-500/20 text-white shadow-[0_0_0_1px_rgba(139,92,246,0.5)]' : 'text-zinc-400 hover:text-white',
                )}
              >
                {mode.label}
                {tags?.[mode.id] ? <span className="ms-1.5 text-[11px] text-violet-300">{tags[mode.id]}</span> : null}
              </button>
            )
          })}
      </div>
    </div>
  )
}
