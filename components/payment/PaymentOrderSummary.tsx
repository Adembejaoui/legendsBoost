'use client'

import type { OrderDraft } from '@/types/order'
import { getGame } from '@/lib/catalog/games'
import { getGameServiceOffer } from '@/lib/catalog/game-services'
import { getServiceTemplate } from '@/lib/catalog/service-templates'

interface PaymentOrderSummaryProps {
  draft: OrderDraft
}

export function PaymentOrderSummary({ draft }: PaymentOrderSummaryProps) {
  const game = getGame(draft.gameSlug)
  const offer = getGameServiceOffer(draft.gameSlug, draft.serviceSlug)
  const template = getServiceTemplate(draft.serviceSlug)

  const configEntries = Object.entries(draft.configuration || {})

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden sticky top-6">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Order Summary</h2>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-zinc-400">Game</span><span className="text-white">{game?.name || draft.gameSlug}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Service</span><span className="text-white">{offer?.title || template?.title || draft.serviceSlug}</span></div>
          {draft.selectedMode ? <div className="flex justify-between"><span className="text-zinc-400">Mode</span><span className="text-white capitalize">{draft.selectedMode}</span></div> : null}
        </div>

        {configEntries.length > 0 ? (
          <div className="border-t border-white/10 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Configuration</p>
            <div className="space-y-2 text-sm">
              {configEntries.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <span className="text-zinc-400">{key}</span>
                  <span className="text-white text-right max-w-[60%] break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {draft.selectedOptions && draft.selectedOptions.length > 0 ? (
          <div className="border-t border-white/10 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Extras</p>
            <div className="text-sm text-white">{draft.selectedOptions.join(', ')}</div>
          </div>
        ) : null}

        {draft.championsRoles ? (
          <div className="border-t border-white/10 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Champions & Roles</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">Roles</span><span className="text-white">{draft.championsRoles.roles.join(', ') || '-'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Champions</span><span className="text-white">{draft.championsRoles.champions.join(', ') || '-'}</span></div>
            </div>
          </div>
        ) : null}

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Total</span>
            <span className="text-lg font-semibold text-white">Price on request</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Final amount calculated by server</p>
        </div>
      </div>
    </div>
  )
}