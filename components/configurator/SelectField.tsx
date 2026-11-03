'use client'

import type { ConfigOption } from '@/types/catalog'
import { cn } from '@/lib/utils'

interface SelectFieldProps {
  label: string
  description?: string
  options: ConfigOption[]
  value: string | null
  onChange: (value: string | null) => void
  required?: boolean
  disabled?: boolean
}

export function SelectField({
  label,
  description,
  options,
  value,
  onChange,
  required,
  disabled = false,
}: SelectFieldProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-white">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </label>
      {description && (
        <p className="text-xs text-zinc-500">{description}</p>
      )}
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={disabled}
        className="w-full rounded-lg border border-white/10 bg-[#111319] px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50 disabled:pointer-events-none"
      >
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {required && !value && (
        <p className="text-xs text-rose-400">This field is required.</p>
      )}
    </div>
  )
}

interface MultiSelectFieldProps {
  label: string
  description?: string
  options: ConfigOption[]
  value: string[]
  onChange: (value: string[]) => void
  required?: boolean
  disabled?: boolean
}

export function MultiSelectField({
  label,
  description,
  options,
  value,
  onChange,
  required,
  disabled = false,
}: MultiSelectFieldProps) {
  const isSelected = (val: string) => value.includes(val)

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
        {options.map((option) => {
          const selected = isSelected(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                const next = isSelected(option.value)
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value]
                onChange(next)
              }}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                selected
                  ? 'border-violet-400 bg-violet-500/10 text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 bg-[#111319] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {required && value.length === 0 && (
        <p className="text-xs text-rose-400">This field is required.</p>
      )}
    </div>
  )
}
