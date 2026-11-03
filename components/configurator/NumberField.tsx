'use client'

import { type ChangeEvent } from 'react'

interface NumberFieldProps {
  label: string
  description?: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  required?: boolean
  disabled?: boolean
}

export function NumberField({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  required,
  disabled = false,
}: NumberFieldProps) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    if (raw === '') {
      onChange(null)
      return
    }
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) return
    onChange(parsed)
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-white">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </label>
      {description && (
        <p className="text-xs text-zinc-500">{description}</p>
      )}
      <div className="relative">
        <input
          type="number"
          value={value ?? ''}
          onChange={handleChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="w-full rounded-lg border border-white/10 bg-[#111319] pl-3 pr-10 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50 disabled:pointer-events-none"
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
            {unit}
          </span>
        )}
      </div>
      {required && value === null && (
        <p className="text-xs text-rose-400">This field is required.</p>
      )}
    </div>
  )
}
