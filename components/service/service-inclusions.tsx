import type { Service } from '@/types/service'
import type { Game } from '@/types/game'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InclusionsProps {
  inclusions?: string[]
  exclusions?: string[]
}

export function ServiceInclusions({ inclusions, exclusions }: InclusionsProps) {
  if (!inclusions && !exclusions) return null

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {inclusions && inclusions.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#111319] p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Check className="size-4 text-emerald-400" />
            What's included
          </h3>
          <ul className="space-y-3">
            {inclusions.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm leading-5 text-zinc-400">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-400/70" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {exclusions && exclusions.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#111319] p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <X className="size-4 text-rose-400" />
            What's not included
          </h3>
          <ul className="space-y-3">
            {exclusions.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm leading-5 text-zinc-400">
                <X className="mt-0.5 size-4 shrink-0 text-rose-400/70" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}