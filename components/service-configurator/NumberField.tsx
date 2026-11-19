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
  const choices =
    min !== undefined && max !== undefined && max - min <= 9 && (step ?? 1) === 1
      ? Array.from({ length: max - min + 1 }, (_, i) => min + i)
      : null
  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
      <div className="mb-3">
        <label className="flex items-center gap-1 text-sm font-medium text-white">
          {label}
          {required ? <span className="text-rose-400">*</span> : null}
        </label>
        {description ? <p className="text-xs text-zinc-400">{description}</p> : null}
      </div>
      {choices ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
          {choices.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              disabled={disabled}
              onClick={() => onChange(n)}
              className={
                'flex h-10 min-w-12 items-center justify-center rounded-md border px-3 text-sm font-semibold transition-all ' +
                (value === n
                  ? 'border-violet-400 bg-violet-500/10 text-white shadow-[0_0_15px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 bg-[#0b0c10] text-zinc-300 hover:border-white/20')
              }
            >
              {n}
              {unit ? <span className="ml-1 text-xs font-normal text-zinc-500">{n === 1 ? unit.replace(/s$/, '') : unit}</span> : null}
            </button>
          ))}
        </div>
      ) : (
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
      )}
    </div>
  )
}
