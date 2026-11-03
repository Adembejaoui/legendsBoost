'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
// import removed
import { getGame } from '@/lib/catalog/games'
import { getGameServiceOffer } from '@/lib/catalog/game-services'
import { getServiceTemplate } from '@/lib/catalog/service-templates'

export function ReviewClient() {
  const params = useSearchParams()
  const router = useRouter()
  const id = params.get('id')
  const [order, setOrder] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!id) {
        setError('Missing order id')
        setLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/orders/${id}`)
        if (!res.ok) {
          setError('order not found')
          setLoading(false)
          return
        }
        const data = await res.json()
        setOrder(data.order)
      } catch (e) {
        setError('Failed to load order')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <>
        <SiteHeader />
        <main className="py-10 px-5 text-white">Loading order...</main>
        <SiteFooter />
      </>
    )
  }

  if (error || !order) {
    return (
      <>
        <SiteHeader />
        <main className="py-10 px-5 text-white">
          <div className="mx-auto max-w-2xl">
            <h1 className="text-xl font-semibold mb-2">Order Review</h1>
            <p className="text-zinc-400">{error || 'order not found'}</p>
            <button onClick={() => router.back()} className="mt-4 px-4 py-2 rounded bg-white/10">Go back</button>
          </div>
        </main>
        <SiteFooter />
      </>
    )
  }

  const game = getGame(order.gameSlug)
  const offer = getGameServiceOffer(order.gameSlug, order.serviceSlug)
  const template = getServiceTemplate(order.serviceSlug)

  return (
    <>
      <SiteHeader />
      <main className="py-10 px-5">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Order Review</h1>
            <p className="text-zinc-400">Review your configuration before proceeding</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Game & Service</h2>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-400">Game</span><span className="text-white">{game?.name}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Service</span><span className="text-white">{offer?.title || template?.title}</span></div>
              {order.selectedMode ? <div className="flex justify-between"><span className="text-zinc-400">Mode</span><span className="text-white capitalize">{order.selectedMode}</span></div> : null}
              <div className="flex justify-between"><span className="text-zinc-400">Status</span><span className="text-white capitalize">{order.status}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Configuration</h2>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm">
              {Object.entries(order.configuration || {}).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-zinc-400">{key}</span>
                  <span className="text-white text-right max-w-[60%] break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                </div>
              ))}
            </div>
          </div>

          {order.selectedOptions && order.selectedOptions.length > 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
              <div className="border-b border-white/10 px-5 py-4">
                <h2 className="text-lg font-semibold text-white">Extras</h2>
              </div>
              <div className="px-5 py-4 text-sm text-white">
                {order.selectedOptions.join(', ')}
              </div>
            </div>
          ) : null}

          {order.championsRoles ? (
            <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
              <div className="border-b border-white/10 px-5 py-4">
                <h2 className="text-lg font-semibold text-white">Champions & Roles</h2>
              </div>
              <div className="px-5 py-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-zinc-400">Roles</span><span className="text-white">{order.championsRoles.roles.join(', ') || '-'}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">Champions</span><span className="text-white">{order.championsRoles.champions.join(', ') || '-'}</span></div>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Pricing</h2>
            </div>
            <div className="px-5 py-4 text-sm text-zinc-400">
              Price on request. No payment or charge has been processed.
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => router.back()} className="px-4 py-2 rounded bg-white/10 text-white">Go back and edit</button>
            <button onClick={() => router.push(`/checkout/payment?orderId=${order.id}`)} className="px-4 py-2 rounded bg-orange-500 text-white">Continue to Payment</button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
