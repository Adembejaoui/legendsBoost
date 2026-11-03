'use client'

interface CheckboxFieldProps {
  label: string
  description?: string
  value: boolean
  onChange: (value: boolean) => void
  required?: boolean
  disabled?: boolean
}

export function CheckboxField({
  label,
  description,
  value,
  onChange,
  required,
  disabled = false,
}: CheckboxFieldProps) {
  return (
    <div className="space-y-2">
      <label
        className="flex items-center gap-2 cursor-pointer select-none disabled:opacity-50"
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="rounded border-white/10 bg-[#111319] text-violet-500 focus:ring-violet-400 focus:ring-1"
        />
        <span className="text-sm font-medium text-white">{label}</span>
      </label>
      {description && (
        <p className="ml-8 text-xs text-zinc-500">{description}</p>
      )}
      {required && !value && (
        <p className="ml-8 text-xs text-rose-400">This field is required.</p>
      )}
    </div>
  )
}
