import type { GameServiceOffer, RankSelection, RankSystem } from '@/types/catalog'
import { formatSelection } from '@/lib/catalog/catalog-utils'
import Image from 'next/image'
import { getTier } from '@/lib/catalog/rank-systems'

interface ServiceSummaryProps {
  values: Record<string, unknown>
  offer: GameServiceOffer
  rankSystems: RankSystem[]
}

export function ServiceSummary({
  values,
  offer,
  rankSystems,
}: ServiceSummaryProps) {
  const lines = buildLines(values, offer, rankSystems)

  if (lines.length === 0) return null

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] p-6">
      <h3 className="mb-3 text-sm font-semibold text-white">Configuration summary</h3>
      <ul className="space-y-2 text-sm text-zinc-400">
        {lines.map((line) => (
          <li key={line.key} className="flex items-center gap-3">
            <span className="shrink-0 text-zinc-500">{line.label}</span>
            <div className="flex items-center gap-2 text-white">
              {line.iconSrc ? (
                <Image src={line.iconSrc} alt={line.value} width={20} height={20} className="size-5 object-contain" />
              ) : null}
              <span>{line.value}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function buildLines(
  values: Record<string, unknown>,
  offer: GameServiceOffer,
  rankSystems: RankSystem[],
): { key: string; label: string; value: string; iconSrc?: string }[] {
  const lines: { key: string; label: string; value: string; iconSrc?: string }[] = []

  for (const field of offer.fields) {
    const raw = values[field.key]
    const label = field.label
    const value = formatFieldValue(field, raw, rankSystems)
    let iconSrc: string | undefined = undefined
    if (field.type === 'rank-picker' && raw && field.rankSystemId) {
      const selection = raw as RankSelection
      const tier = getTier(field.rankSystemId, selection.tierId)
      iconSrc = tier?.iconSrc
    }
    lines.push({ key: field.key, label, value: typeof value === 'string' ? value : String(value), iconSrc })
  }

  return lines
}

function formatFieldValue(
  field: { type: string; rankSystemId?: string },
  raw: unknown,
  rankSystems: RankSystem[],
): string {
  if (raw === null || raw === undefined || raw === '') return 'Not set'

  switch (field.type) {
    case 'rank-picker': {
      const selection = raw as RankSelection | null
      const system = field.rankSystemId ? rankSystems.find((s) => s.id === field.rankSystemId) : undefined
      return system ? formatSelection(system.id, selection) : 'Not set'
    }
    case 'multi-select':
      return (raw as string[]).join(', ') || 'Not set'
    case 'number':
      return String(raw)
    case 'checkbox':
      return Boolean(raw) ? 'Yes' : 'No'
    case 'champion-picker':
      return String(raw)
    default:
      return String(raw)
  }
}
