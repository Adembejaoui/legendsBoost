'use client'

import type { ConfigField, ConfigOption } from '@/types/catalog'
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

export function SelectField({ label, description, options, value, onChange, required, disabled = false }: SelectFieldProps) {
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
        <option value="">Select an option</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
