'use client'

import type { ConfigField, GameServiceOffer, RankSelection, RankSystem } from '@/types/catalog'
import { useMemo } from 'react'
import { formatSelection } from '@/lib/catalog/catalog-utils'
import Image from 'next/image'
import { getTier } from '@/lib/catalog/rank-systems'

interface CheckoutPanelProps {
  offer: GameServiceOffer
  values: Record<string, unknown>
  rankSystems: RankSystem[]
  gameSlug: string
  onRequestQuote?: () => void
}

export function CheckoutPanel({ offer, values, rankSystems, gameSlug, onRequestQuote }: CheckoutPanelProps) {
  const summaryLines = useMemo(() => {
    const lines: { key: string; label: string; value: string; iconSrc?: string }[] = []
    for (const field of offer.fields) {
      const raw = values[field.key]
      if (raw === null || raw === undefined || raw === '') continue
      if (field.type === 'rank-picker') {
        const sel = raw as RankSelection
        const sys = (field as any).rankSystemId ? rankSystems.find((s) => s.id === (field as any).rankSystemId) : undefined
        const tier = sys && sel ? getTier(sys.id, sel.tierId) : undefined
        lines.push({
          key: field.key,
          label: field.label,
          value: sys ? formatSelection(sys.id, sel) : `${sel.tierId}`,
          iconSrc: tier?.iconSrc,
        })
      } else if (field.type === 'number') {
        lines.push({ key: field.key, label: field.label, value: String(raw) })
      } else if (field.type === 'select') {
        lines.push({ key: field.key, label: field.label, value: String(raw) })
      } else if (field.type === 'multi-select') {
        lines.push({ key: field.key, label: field.label, value: Array.isArray(raw) ? raw.join(', ') : String(raw) })
      } else if (field.type === 'champion-picker') {
        lines.push({ key: field.key, label: field.label, value: String(raw) })
      }
    }
    return lines
  }, [values, offer, rankSystems])

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Checkout</h2>
        <p className="text-xs text-zinc-400">Review your configuration</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Configuration</p>
          {summaryLines.length === 0 ? (
            <p className="text-sm text-zinc-500">No selections yet.</p>
          ) : (
            <div className="space-y-2">
              {summaryLines.map((l) => (
                <div key={l.key} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">{l.label}</span>
                  <div className="flex items-center gap-2 text-white">
                    {l.iconSrc ? <Image src={l.iconSrc} alt={l.value} width={20} height={20} className="size-5 object-contain" /> : null}
                    <span>{l.value}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Total</span>
            <span className="text-lg font-semibold text-white">Price on request</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Pricing not configured for this offer</p>
        </div>

        <button
          type="button"
          onClick={onRequestQuote}
          disabled={offer.availability !== 'available'}
          className="w-full rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {offer.availability === 'available' ? 'Request a quote' : 'Under review'}
        </button>
        <p className="text-center text-xs text-zinc-500">No account credentials requested</p>
      </div>
    </div>
  )
}
