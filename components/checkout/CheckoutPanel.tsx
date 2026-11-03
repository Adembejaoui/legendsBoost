'use client'

import type { CheckoutMode, CheckoutOption, ChampionsRolesConfig, GameCheckoutConfig } from '@/lib/config/checkout-options'
import { useEffect, useMemo, useState } from 'react'
import { CheckoutModeSelector } from './CheckoutModeSelector'
import { CheckoutOptionRow } from './CheckoutOptionRow'
import { ChampionsRolesModal } from './ChampionsRolesModal'
import { formatSelection } from '@/lib/catalog/catalog-utils'
import { getTier } from '@/lib/catalog/rank-systems'
import Image from 'next/image'
import { getCheckoutConfig, getCheckoutOptionsForMode } from '@/lib/config/checkout-options'
import { useRouter } from 'next/navigation'

interface CheckoutPanelProps {
  game: { slug: string; name: string; accent?: string }
  offer: any
  values: Record<string, unknown>
  rankSystems: any[]
  onOrderCreated?: (draft: any) => void
}

type CheckoutSelections = {
  solo: Record<string, boolean>
  duo: Record<string, boolean>
}

export function CheckoutPanel({ game, offer, values, rankSystems, onOrderCreated }: CheckoutPanelProps) {
  const config = getCheckoutConfig(game.slug, offer.serviceSlug)
  const router = useRouter()
  const [mode, setMode] = useState<CheckoutMode>(() => {
    const first = config?.modes?.find((m: any) => m.enabled)?.id
    return (first as CheckoutMode) ?? 'solo'
  })
  const [extrasByMode, setExtrasByMode] = useState<CheckoutSelections>({
    solo: {},
    duo: {},
  })
  const [championsRolesByMode, setChampionsRolesByMode] = useState<Record<CheckoutMode, ChampionsRolesConfig>>({
    solo: { roles: [], champions: [] },
    duo: { roles: [], champions: [] },
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [activeConfigureId, setActiveConfigureId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'validating' | 'creating' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Initialize defaults per game/service/mode
  useEffect(() => {
    if (!config) {
      setExtrasByMode({ solo: {}, duo: {} })
      return
    }
    const next: CheckoutSelections = { solo: {}, duo: {} }
    for (const o of config.options) {
      if (o.defaultEnabled) {
        const modes = o.availableModes || ['solo', 'duo']
        for (const m of modes) {
          if (m === 'solo' || m === 'duo') {
            next[m][o.id] = true
          }
        }
      }
    }
    setExtrasByMode(next)
  }, [config, game.slug, offer.serviceSlug])

  const visibleOptions = config ? getCheckoutOptionsForMode(config, mode) : []

  const summaryLines = useMemo(() => {
    const lines: { key: string; label: string; value: string; iconSrc?: string }[] = []
    for (const field of offer.fields || []) {
      const raw = values[field.key]
      if (raw === null || raw === undefined || raw === '') continue
      if (field.type === 'rank-picker') {
        const sel = raw as any
        const sys = (field as any).rankSystemId ? rankSystems.find((s: any) => s.id === (field as any).rankSystemId) : undefined
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

  const allowDraft = config?.allowDraft ?? true
  const canCreateDraft = allowDraft && offer.visibility !== 'hidden'
  const canOrder = config?.allowOrder && offer.availability === 'available'

  const handleOrder = async () => {
    setErrorMsg(null)
    if (!canCreateDraft && !canOrder) {
      setErrorMsg('This service is not available for ordering.')
      setStatus('error')
      return
    }

    // Validate required fields
    setStatus('validating')
    if (Array.isArray(offer.fields)) {
      for (const field of offer.fields) {
        if (field.required) {
          const val = values[field.key]
          if (val === undefined || val === null || val === '') {
            setErrorMsg(`Missing required field: ${field.label}`)
            setStatus('error')
            return
          }
        }
      }
    }
    setStatus('creating')

    const selectedOptions: string[] = []
    for (const [k, v] of Object.entries(extrasByMode[mode] || {})) {
      if (v) selectedOptions.push(k)
    }

    const payload = {
      gameSlug: game.slug,
      serviceSlug: offer.serviceSlug,
      configuration: values,
      selectedMode: config?.modes && config.modes.length > 0 ? mode : undefined,
      selectedOptions,
      championsRoles: championsRolesByMode[mode],
    }

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setErrorMsg(err.error || 'Failed to create order draft')
        setStatus('error')
        return
      }
      const data = await res.json()
      const orderId = data?.order?.id
      setStatus('idle')
      if (onOrderCreated) {
        onOrderCreated(data.order)
      }
      if (orderId) {
        router.push(`/checkout/review?id=${orderId}`)
        return
      }
      alert('Order draft created (dev preview).')
    } catch (e) {
      setErrorMsg('Failed to create order draft')
      setStatus('error')
    }
  }

  const isSubmitting = status === 'validating' || status === 'creating'

  const getButtonLabel = () => {
    if (isSubmitting) return status === 'validating' ? 'Validating...' : 'Creating draft...'
    if (offer.availability === 'available' && canOrder) return 'Place order'
    if (canCreateDraft) return 'Create order draft'
    if (offer.availability !== 'available') return 'Under review'
    return 'Request a quote'
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#111319] overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Checkout</h2>
        <p className="text-xs text-zinc-400">Review your configuration and extras</p>
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

        {config && config.modes && config.modes.length > 0 ? (
          <CheckoutModeSelector modes={config.modes as any} value={mode} onChange={(m) => setMode(m as CheckoutMode)} />
        ) : null}

        {visibleOptions.length > 0 ? (
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Extras</p>
            <div className="space-y-2">
              {visibleOptions.map((option: CheckoutOption) => {
                const checked = extrasByMode[mode]?.[option.id] ?? false
                return (
                  <CheckoutOptionRow
                    key={`${game.slug}-${offer.serviceSlug}-${option.id}-${mode}`}
                    option={option}
                    checked={extrasByMode[mode]?.[option.id] ?? false}
                    onToggle={(v) => setExtrasByMode((e) => ({ ...e, [mode]: { ...(e[mode] || {}), [option.id]: Boolean(v) } }))}
                    disabled={offer.availability !== 'available' && config?.allowOrder !== true ? false : (option.enabled === false)}
                    championsRoles={championsRolesByMode[mode]}
                    onConfigureChampionsRoles={() => {
                      setActiveConfigureId(option.id)
                      setModalOpen(true)
                    }}
                  />
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Total</span>
            <span className="text-lg font-semibold text-white">Price on request</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Pricing not configured for this offer</p>
        </div>

        <button
          type="button"
          onClick={handleOrder}
          disabled={isSubmitting || (!canCreateDraft && !canOrder)}
          className="w-full rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {getButtonLabel()}
        </button>
        {errorMsg ? <p className="text-center text-xs text-rose-400">{errorMsg}</p> : null}
        <p className="text-center text-xs text-zinc-500">No account credentials requested</p>
      </div>

      <ChampionsRolesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialValue={championsRolesByMode[mode]}
        onConfirm={(cfg) => {
          setChampionsRolesByMode((prev) => ({ ...prev, [mode]: cfg }))
          setModalOpen(false)
        }}
      />
    </div>
  )
}
