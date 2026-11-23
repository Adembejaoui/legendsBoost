'use client'

import { useTranslations } from 'next-intl'

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
  /** input (default), slider with a progress bar, or dropdown. */
  display?: 'input' | 'slider' | 'select'
  /** Dropdown label, e.g. "Level {n}". */
  optionLabel?: string
  /** Render without its own box (inside a grouped box). */
  bare?: boolean
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

/**
 * Number field (client PDFs 2026-11-19): a slider with a filled progress bar
 * and the chosen number shown large (wins, matches), a dropdown (mastery
 * levels), or a plain number box.
 */
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
  display = 'input',
  optionLabel,
  bare = false,
}: NumberFieldProps) {
  const t = useTranslations('Service')
  const lo = min ?? 1
  const hi = max ?? lo

  if (display === 'select') {
    const select = (
      <label className="block min-w-0">
        <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-zinc-300">
          {label}
          {required ? <span className="text-rose-400">*</span> : null}
        </span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={disabled}
          className="h-10 w-full rounded-md border border-white/10 bg-[#0b0c10] px-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
        >
          {value == null ? <option value="">{t('select')}</option> : null}
          {range(lo, hi).map((n) => (
            <option key={n} value={n}>
              {optionLabel ? optionLabel.replace('{n}', String(n)) : n}
            </option>
          ))}
        </select>
      </label>
    )
    return bare ? select : <div className="rounded-xl border border-white/10 bg-[#111319] p-4">{select}</div>
  }

  if (display === 'slider' && max !== undefined) {
    const current = value ?? lo
    const pct = hi > lo ? ((current - lo) / (hi - lo)) * 100 : 100
    const unitLabel = unit ? (current === 1 ? unit.replace(/s$/, '') : unit) : ''
    return (
      <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 bg-[#0b0c10] text-xl font-bold tabular-nums text-white">
            {current}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold text-white">
              {label}
              {required ? <span className="text-rose-400">*</span> : null}
            </p>
            <p className="text-xs text-zinc-400">{description ?? `${current} ${unitLabel}`}</p>
          </div>
        </div>
        <input
          type="range"
          min={lo}
          max={hi}
          step={step ?? 1}
          value={current}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          aria-valuetext={`${current} ${unitLabel}`.trim()}
          style={{ background: `linear-gradient(to right, #8b5cf6 0%, #a78bfa ${pct}%, rgba(255,255,255,0.08) ${pct}%)` }}
          className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(139,92,246,0.35)]"
        />
        <div className="mt-1.5 flex justify-between px-0.5 text-[11px] tabular-nums text-zinc-500" aria-hidden>
          {range(lo, hi).map((n) => (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => onChange(n)}
              className={n === current ? 'font-semibold text-white' : 'hover:text-zinc-300'}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-4">
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
        {unit ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">{unit}</span> : null}
      </div>
    </div>
  )
}
