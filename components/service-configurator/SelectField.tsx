'use client'

import type { ConfigField, ConfigOption } from '@/types/catalog'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface SelectFieldProps {
  label: string
  description?: string
  options: ConfigOption[]
  value: string | null
  onChange: (value: string | null) => void
  required?: boolean
  disabled?: boolean
}

/**
 * Small dropdown used side by side in a row (client PDFs 2026-11-19:
 * Current LP, LP Gain, Server and Queue Type together in the rank box).
 */
export function InlineSelectField({ label, description, options, value, onChange, required, disabled = false }: SelectFieldProps) {
  const t = useTranslations('Service')
  return (
    <label className="block min-w-0" title={description}>
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-zinc-300">
        {label}
        {required ? <span className="text-rose-400">*</span> : null}
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="h-9 w-full min-w-0 truncate rounded-md border border-white/10 bg-[#0b0c10] px-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
      >
        {value == null || value === '' ? <option value="">{t('select')}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * A few options as side-by-side buttons (Normal Games: Games / Wins, client
 * PDF 2026-11-25). Each option's help text shows on hover or keyboard focus.
 */
export function ToggleSelectField({ label, description, options, value, onChange, required, disabled = false }: SelectFieldProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-5">
      <div className="mb-3">
        <p className="flex items-center gap-1 text-sm font-medium text-white">
          {label}
          {required ? <span className="text-rose-400">*</span> : null}
        </p>
        {description ? <p className="text-xs text-zinc-400">{description}</p> : null}
      </div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const active = value === o.value
          const tipId = o.description ? `opt-tip-${o.value}` : undefined
          return (
            <div key={o.value} className="group relative">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-describedby={tipId}
                disabled={disabled}
                title={o.description}
                onClick={() => onChange(o.value)}
                className={cn(
                  'h-10 w-full rounded-md border text-sm font-semibold transition-colors disabled:opacity-50',
                  active
                    ? 'border-violet-400 bg-violet-500/20 text-white'
                    : 'border-white/10 bg-[#0b0c10] text-zinc-300 hover:border-white/25 hover:text-white',
                )}
              >
                {o.label}
              </button>
              {o.description ? (
                <span
                  id={tipId}
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full start-0 z-20 mb-2 hidden w-56 rounded-md border border-white/10 bg-[#1b1e27] px-2.5 py-1.5 text-xs text-zinc-200 shadow-lg group-focus-within:block group-hover:block"
                >
                  {o.description}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SelectField({ label, description, options, value, onChange, required, disabled = false }: SelectFieldProps) {
  const t = useTranslations('Service')
  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-5">
      <div className="mb-3">
        <label className="flex items-center gap-1 text-sm font-medium text-white">
          {label}
          {required ? <span className="text-rose-400">*</span> : null}
        </label>
        {description ? <p className="text-xs text-zinc-400">{description}</p> : null}
      </div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full rounded-md border border-white/10 bg-[#0b0c10] px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
      >
        <option value="">{t('selectOption')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
