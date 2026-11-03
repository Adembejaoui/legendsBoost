'use client'

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
  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-5">
      <div className="mb-3">
        <label className="flex items-center gap-1 text-sm font-medium text-white">
          {label}
          {required ? <span className="text-rose-400">*</span> : null}
        </label>
        {description ? <p className="text-xs text-zinc-400">{description}</p> : null}
      </div>
      <div className="relative">
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onChange(null)
            const n = Number(raw)
            if (Number.isNaN(n)) return
            onChange(n)
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="w-full rounded-md border border-white/10 bg-[#0b0c10] px-3 py-2 pr-10 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
        />
        {unit ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">{unit}</span>
        ) : null}
      </div>
    </div>
  )
}
