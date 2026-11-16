'use client'

/**
 * Checkout step 3 panel: live server quote + ONE action, "Continue to Payment",
 * which goes straight to Stripe Checkout (step 4). No review page in between.
 *
 *   1. validate the configuration (required fields, client-side; the server
 *      re-validates everything);
 *   2. use the live quote for exactly this configuration, or refresh it;
 *   3. create the order through POST /api/orders with an Idempotency-Key that
 *      is bound to this exact request: a double click, a retry or coming back
 *      from Stripe replays the SAME order instead of creating another;
 *   4. create the Stripe Checkout Session (POST /api/orders/:id/checkout);
 *   5. redirect to Stripe. If step 4 fails, the unpaid order is kept and the
 *      same button retries safely (same key -> same order).
 *
 * Prices are never computed here: every amount shown comes from the server.
 */
import type { CheckoutMode, CheckoutOption, ChampionsRolesConfig } from '@/lib/config/checkout-options'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Loader2, Lock } from 'lucide-react'
import { CheckoutModeSelector } from './CheckoutModeSelector'
import { CheckoutOptionRow } from './CheckoutOptionRow'
import { ChampionsRolesModal } from './ChampionsRolesModal'
import { formatSelection } from '@/lib/catalog/catalog-utils'
import { getTier } from '@/lib/catalog/rank-systems'
import { getCheckoutConfig, getCheckoutOptionsForMode } from '@/lib/config/checkout-options'
import { formatMoney } from '@/lib/money'
import { evaluateOrderEligibility, NOT_PURCHASABLE_MESSAGE } from '@/lib/orders/order-eligibility'
import { newIdempotencyKey, patchCheckout, readCheckout, type StoredCheckout } from '@/lib/checkout/session-state'
import { PREFERRED_BOOSTER_KEY } from '@/components/boosters/ChooseBoosterButton'
import { redirectToStripeCheckout } from '@/lib/checkout/redirect'
import { RISK_DISCLOSURE_TEXT } from '@/lib/orders/risk-disclosure'

interface CheckoutPanelProps {
  game: { slug: string; name: string; accent?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- serialized offer from the server page
  offer: any
  values: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rank systems passed through for display
  rankSystems: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy callback shape
  onOrderCreated?: (order: any) => void
}

type Selections = { solo: Record<string, boolean>; duo: Record<string, boolean> }
type QuoteLine = { code: string; label: string; amount: number }
type ServerQuote = {
  totalAmount: number
  currency: string
  lines?: QuoteLine[]
  estimate?: { hours: number; label: string } | null
  discountAmount?: number
  coupon?: { code: string; applied: boolean; reason?: string } | null
}
type QuoteOutcome = { kind: 'ok'; quote: ServerQuote } | { kind: 'error'; error: string } | { kind: 'signin' }
type QuoteResult = QuoteOutcome & { payloadJson: string }
type Phase = 'idle' | 'quoting' | 'creating' | 'paying' | 'redirecting'

const QUOTE_DEBOUNCE_MS = 350

async function requestQuote(payloadJson: string, signal?: AbortSignal): Promise<QuoteOutcome> {
  const res = await fetch('/api/orders/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadJson, signal })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) return { kind: 'signin' }
  if (!res.ok) return { kind: 'error', error: data.error || 'The price could not be calculated.' }
  return { kind: 'ok', quote: data.quote as ServerQuote }
}

function loginHref() {
  const path = typeof window === 'undefined' ? '/games' : window.location.pathname
  return `/login?callbackUrl=${encodeURIComponent(path)}`
}

export function CheckoutPanel({ game, offer, values, rankSystems, onOrderCreated }: CheckoutPanelProps) {
  const config = getCheckoutConfig(game.slug, offer.serviceSlug)
  const enabledModes = useMemo(() => (config?.modes ?? []).filter((m) => m.enabled), [config])
  const [mode, setMode] = useState<CheckoutMode>(() => (enabledModes[0]?.id as CheckoutMode) ?? 'solo')
  const [extrasByMode, setExtrasByMode] = useState<Selections>({ solo: {}, duo: {} })
  const [championsRolesByMode, setChampionsRolesByMode] = useState<Record<CheckoutMode, ChampionsRolesConfig>>({
    solo: { roles: [], champions: [] },
    duo: { roles: [], champions: [] },
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Discount code: the draft typed in the field, and the code sent to the server.
  const [couponDraft, setCouponDraft] = useState('')
  const [couponCode, setCouponCode] = useState<string | null>(null)
  const [lastCouponError, setLastCouponError] = useState<string | null>(null)
  // Risk notice: must be ticked before paying (stored on the order).
  const [riskAccepted, setRiskAccepted] = useState(false)
  // Optional preferred booster (exclusive for a short time after payment).
  const [boosters, setBoosters] = useState<{ id: string; displayName: string }[]>([])
  // A booster chosen on their public profile is preselected (if they can do this order).
  const [preferredBoosterId, setPreferredBoosterId] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return sessionStorage.getItem(PREFERRED_BOOSTER_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [needsSignIn, setNeedsSignIn] = useState(false)
  // Bumped to force a new live quote for an unchanged configuration (e.g. after a 409 price change).
  const [quoteNonce, setQuoteNonce] = useState(0)
  // Synchronous guard: a second click arrives before React re-renders the disabled button.
  const busyRef = useRef(false)
  const attemptRef = useRef<StoredCheckout['attempt']>(undefined)

  // Restore selections (back navigation, Stripe "back", sign-in round trip).
  // Runs after hydration on purpose: the server cannot read sessionStorage.
  useEffect(() => {
    const saved = readCheckout(game.slug, offer.serviceSlug)
    attemptRef.current = saved.attempt
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from sessionStorage after hydration */
    if (saved.mode && enabledModes.some((m) => m.id === saved.mode)) setMode(saved.mode)
    if (saved.extras) setExtrasByMode(saved.extras)
    if (saved.championsRoles) setChampionsRolesByMode(saved.championsRoles)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [game.slug, offer.serviceSlug, enabledModes])

  const remember = (patch: Partial<StoredCheckout>) => patchCheckout(game.slug, offer.serviceSlug, patch)
  const changeMode = (m: CheckoutMode) => {
    setMode(m)
    remember({ mode: m })
  }
  const toggleExtra = (id: string, on: boolean) => {
    setExtrasByMode((prev) => {
      const next = { ...prev, [mode]: { ...(prev[mode] || {}), [id]: on } }
      remember({ extras: next })
      return next
    })
    // Turning on "Champions and Roles Selection" opens its picker right away.
    const option = config?.options.find((o) => o.id === id)
    if (on && option?.configurationType === 'champions-roles') setModalOpen(true)
  }

  // Badges come from the real configured price; an extra with no price is
  // hidden (the server would refuse it). Without a price list (unpriced
  // service) nothing is purchasable anyway, so the catalog badges are kept.
  const priceTags = offer.priceTags as { options: Record<string, string>; modes: Record<string, string> } | null | undefined
  const visibleOptions = (config ? getCheckoutOptionsForMode(config, mode) : [])
    .filter((o) => !priceTags || o.id in priceTags.options)
    .map((o) => (priceTags ? { ...o, badge: priceTags.options[o.id] } : o))

  const summaryLines = useMemo(() => {
    const lines: { key: string; label: string; value: string; iconSrc?: string }[] = []
    for (const field of offer.fields || []) {
      const raw = values[field.key]
      if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue
      if (field.type === 'rank-picker') {
        const sel = raw as { tierId: string; divisionId: string | null }
        const sys = field.rankSystemId ? rankSystems.find((s) => s.id === field.rankSystemId) : undefined
        const tier = sys && sel ? getTier(sys.id, sel.tierId) : undefined
        lines.push({ key: field.key, label: field.label, value: sys ? formatSelection(sys.id, sel) : `${sel.tierId}`, iconSrc: tier?.iconSrc })
      } else if (field.type === 'select' || field.type === 'multi-select') {
        const opts: { label: string; value: string }[] = field.options ?? []
        const label = (v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v)
        lines.push({ key: field.key, label: field.label, value: Array.isArray(raw) ? raw.map(label).join(', ') : label(raw) })
      } else if (field.type === 'checkbox') {
        lines.push({ key: field.key, label: field.label, value: raw ? 'Yes' : 'No' })
      } else {
        lines.push({ key: field.key, label: field.label, value: String(raw) })
      }
    }
    return lines
  }, [values, offer, rankSystems])

  // Server-computed eligibility from the page (catalog + Stripe mode + price).
  // Without it, fall back to the strictest (live) form of the pure rule.
  const canOrder: boolean = offer.purchase ? offer.purchase.orderable === true : evaluateOrderEligibility(offer, config).ok
  const testMode = canOrder && offer.purchase?.testMode === true

  const missing: string[] = (offer.fields || [])
    .filter((f: { required?: boolean; key: string }) => f.required)
    .filter((f: { key: string }) => {
      const v = values[f.key]
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    })
    .map((f: { label: string }) => f.label)

  const selectedOptions = Object.entries(extrasByMode[mode] || {})
    .filter(([id, on]) => on && visibleOptions.some((o) => o.id === id && o.enabled !== false))
    .map(([id]) => id)
    .sort()
  const payload = {
    gameSlug: game.slug,
    serviceSlug: offer.serviceSlug,
    configuration: values,
    selectedMode: enabledModes.length > 0 ? mode : undefined,
    selectedOptions,
    championsRoles: championsRolesByMode[mode],
    ...(couponCode ? { couponCode } : {}),
  }
  const payloadJson = JSON.stringify(payload)
  const ready = canOrder && missing.length === 0

  // Live quote: refresh (debounced) whenever the complete configuration changes.
  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      requestQuote(payloadJson, ctrl.signal)
        .then((r) => {
          setQuoteResult({ ...r, payloadJson } as QuoteResult)
          // A code the server refused is shown with its reason and not sent
          // again, so the order goes ahead at the normal price.
          const c = r.kind === 'ok' ? r.quote.coupon : null
          if (c && !c.applied) {
            setCouponCode(null)
            setLastCouponError(`${c.code}: ${c.reason ?? 'not valid'}`)
          }
        })
        .catch((e) => {
          if ((e as Error)?.name !== 'AbortError') setQuoteResult({ payloadJson, kind: 'error', error: 'The price could not be calculated. Check your connection.' })
        })
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [payloadJson, ready, quoteNonce])

  // Boosters the customer may choose for this exact configuration.
  const boosterKey = JSON.stringify({ gameSlug: game.slug, serviceSlug: offer.serviceSlug, configuration: values })
  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch('/api/checkout/preferred-boosters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: boosterKey, signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { boosters: [] }))
        .then((d: { boosters?: { id: string; displayName: string }[] }) => setBoosters(d.boosters ?? []))
        .catch(() => {})
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [boosterKey, ready])
  const chosenBooster = boosters.some((b) => b.id === preferredBoosterId) ? preferredBoosterId : ''

  const current = quoteResult?.payloadJson === payloadJson ? quoteResult : null
  const quote = current?.kind === 'ok' ? current.quote : null

  const quoteLoading = ready && !current
  const signInRequired = needsSignIn || current?.kind === 'signin'

  const fail = (message: string) => {
    setErrorMsg(message)
    setPhase('idle')
    busyRef.current = false
  }

  async function createOrder(attempt: NonNullable<StoredCheckout['attempt']>, expected: ServerQuote) {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
      body: JSON.stringify({
        ...payload,
        ...(chosenBooster ? { preferredBoosterId: chosenBooster } : {}),
        riskAccepted: true,
        expectedTotal: { amount: expected.totalAmount, currency: expected.currency },
      }),
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  async function continueToPayment() {
    if (busyRef.current) return
    busyRef.current = true
    setErrorMsg(null)

    // 1. Validate.
    if (!canOrder) return fail(offer.purchase?.reason === 'unpriced' ? 'Pricing for this service is not available yet.' : NOT_PURCHASABLE_MESSAGE)
    if (missing.length) return fail(`Please complete: ${missing.join(', ')}.`)

    try {
      // 2. Quote for exactly this configuration (fresh, or refreshed now).
      let q = quote
      if (!q) {
        setPhase('quoting')
        const r = await requestQuote(payloadJson)
        setQuoteResult({ ...r, payloadJson } as QuoteResult)
        if (r.kind === 'signin') {
          setNeedsSignIn(true)
          return fail('Please sign in to continue to payment. Your selections are saved.')
        }
        if (r.kind === 'error') return fail(r.error)
        q = r.quote
      }

      // 3. Create (or replay) the order. The key is bound to request + shown total.
      setPhase('creating')
      const attemptBody = JSON.stringify({ payloadJson, total: q.totalAmount, currency: q.currency })
      let attempt = attemptRef.current
      if (!attempt || attempt.payloadJson !== attemptBody) attempt = { key: newIdempotencyKey(), payloadJson: attemptBody }
      attemptRef.current = attempt
      remember({ attempt })

      let { res, data } = await createOrder(attempt, q)
      // A replayed order that is no longer payable (already paid / cancelled): start a new one.
      if (res.ok && (data.order?.paid || (data.order?.status && data.order.status !== 'AWAITING_PAYMENT'))) {
        attempt = { key: newIdempotencyKey(), payloadJson: attemptBody }
        attemptRef.current = attempt
        remember({ attempt })
        ;({ res, data } = await createOrder(attempt, q))
      }
      if (res.status === 401) {
        setNeedsSignIn(true)
        return fail('Please sign in to continue to payment. Your selections are saved.')
      }
      if (res.status === 409) {
        // Price changed since it was shown: show the new price, never charge the old one.
        setQuoteResult(null)
        setQuoteNonce((n) => n + 1)
        attemptRef.current = undefined
        remember({ attempt: undefined })
        return fail(data.error || 'The price has changed. Please review the new total.')
      }
      if (!res.ok || !data.order?.id) return fail(data.error || 'Your order could not be created. Please try again.')
      const orderId: string = data.order.id
      attempt = { ...attempt, orderId }
      attemptRef.current = attempt
      remember({ attempt })
      onOrderCreated?.(data.order)

      // 4. Stripe Checkout Session.
      setPhase('paying')
      const co = await fetch(`/api/orders/${orderId}/checkout`, { method: 'POST' })
      const coData = await co.json().catch(() => ({}))
      if (!co.ok || !coData.url) {
        return fail(
          `${coData.error || 'The payment could not be started.'} Nothing was charged. Press "Continue to Payment" to try again.`,
        )
      }

      // 5. Redirect to Stripe (step 4). The button stays disabled.
      setPhase('redirecting')
      redirectToStripeCheckout(coData.url)
    } catch {
      fail('Network error. Your selections are saved: please try again.')
    }
  }

  const busy = phase !== 'idle'
  const buttonLabel =
    phase === 'quoting' ? 'Calculating price…'
    : phase === 'creating' ? 'Creating your order…'
    : phase === 'paying' ? 'Preparing secure payment…'
    : phase === 'redirecting' ? 'Redirecting to Stripe…'
    : canOrder ? 'Continue to Payment'
    : 'Unavailable'

  const optionLabel = (id: string) => config?.options.find((o) => o.id === id)?.label ?? id
  const lineLabel = (l: QuoteLine) => {
    if (l.code === 'BASE') return 'Base price'
    if (l.code.startsWith('STEPS:')) {
      const tier = l.code.slice(6)
      return `${tier.charAt(0).toUpperCase()}${tier.slice(1)} divisions`
    }
    if (l.code.startsWith('UNITS:')) return l.label
    if (l.code.startsWith('MODE:')) return `${enabledModes.find((m) => `MODE:${m.id}` === l.code)?.label ?? l.code.slice(5)} mode`
    if (l.code.startsWith('OPTION:')) return optionLabel(l.code.slice(7))
    if (l.code === 'LP:CURRENT') return 'Current LP discount'
    if (l.code === 'LP:GAIN') return l.amount > 0 ? 'Low LP gain' : 'High LP gain'
    return l.label
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111319]">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Order summary</h2>
        <p className="text-xs text-zinc-400">
          {game.name} · {offer.title ?? offer.serviceSlug}
        </p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Configuration</p>
          {summaryLines.length === 0 ? (
            <p className="text-sm text-zinc-500">No selections yet.</p>
          ) : (
            <div className="space-y-2">
              {summaryLines.map((l) => (
                <div key={l.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-400">{l.label}</span>
                  <div className="flex items-center gap-2 text-right text-white">
                    {l.iconSrc ? <Image src={l.iconSrc} alt="" width={20} height={20} className="size-5 object-contain" /> : null}
                    <span>{l.value}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {enabledModes.length > 0 ? (
          <CheckoutModeSelector
            modes={(priceTags ? enabledModes.filter((m) => m.id in priceTags.modes) : enabledModes) as never}
            tags={priceTags?.modes}
            value={mode}
            onChange={(m) => changeMode(m as CheckoutMode)}
          />
        ) : null}

        {visibleOptions.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Extras</p>
            <div className="space-y-2">
              {visibleOptions.map((option: CheckoutOption) => (
                <CheckoutOptionRow
                  key={`${game.slug}-${offer.serviceSlug}-${option.id}-${mode}`}
                  option={option}
                  checked={extrasByMode[mode]?.[option.id] ?? false}
                  onToggle={(v) => toggleExtra(option.id, Boolean(v))}
                  disabled={option.enabled === false || busy}
                  championsRoles={championsRolesByMode[mode]}
                  onConfigureChampionsRoles={() => setModalOpen(true)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-t border-white/10 pt-4" aria-live="polite">
          {quote?.lines?.length ? (
            <div className="mb-3 space-y-1.5">
              {quote.lines.map((l) => (
                <div key={l.code} className="flex justify-between text-sm">
                  <span className="text-zinc-400">{lineLabel(l)}</span>
                  <span className="text-zinc-200">{formatMoney(l.amount, quote.currency)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {quote?.discountAmount && quote.coupon?.applied ? (
            <div className="mb-3 flex justify-between text-sm">
              <span className="text-emerald-300">Discount ({quote.coupon.code})</span>
              <span className="text-emerald-300">-{formatMoney(quote.discountAmount, quote.currency)}</span>
            </div>
          ) : null}
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const code = couponDraft.trim().toUpperCase()
              setLastCouponError(null)
              setCouponCode(code || null)
            }}
          >
            <input
              value={couponDraft}
              onChange={(e) => setCouponDraft(e.target.value)}
              placeholder="Discount code"
              maxLength={32}
              aria-label="Discount code"
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm uppercase text-white outline-none placeholder:normal-case placeholder:text-zinc-500 focus:border-white/30"
            />
            {couponCode && quote?.coupon?.applied ? (
              <button
                type="button"
                onClick={() => {
                  setCouponCode(null)
                  setCouponDraft('')
                }}
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
              >
                Remove
              </button>
            ) : (
              <button type="submit" disabled={!couponDraft.trim() || busy} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-50">
                Apply
              </button>
            )}
          </form>
          {lastCouponError ? <p role="alert" className="-mt-2 mb-3 text-xs text-amber-300">{lastCouponError}</p> : null}
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Total</span>
            <span className="flex items-center gap-2 text-lg font-semibold text-white">
              {quoteLoading ? <Loader2 className="size-4 animate-spin text-zinc-400" aria-label="Calculating price" /> : null}
              {quote ? formatMoney(quote.totalAmount, quote.currency) : '—'}
            </span>
          </div>
          {quote?.estimate ? (
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Estimated completion</span>
              <span className="text-zinc-200" title="An estimate based on typical games per day, not a guarantee.">
                {quote.estimate.label}
              </span>
            </div>
          ) : null}
          <p className="mt-1 text-xs text-zinc-500">
            {!canOrder
              ? offer.purchase?.reason === 'unpriced'
                ? 'Pricing for this service is not available yet.'
                : 'This service is not available for purchase yet.'
              : missing.length
                ? `Complete: ${missing.join(', ')}`
                : signInRequired
                  ? 'Sign in to see your price.'
                  : current?.kind === 'error'
                    ? current.error
                    : quote
                      ? 'Calculated by our server for this exact configuration.'
                      : 'Calculating your price…'}
          </p>
        </div>

        {!signInRequired && boosters.length > 0 ? (
          <label className="block text-[11px] text-zinc-400">
            Booster
            <select
              value={chosenBooster}
              onChange={(e) => setPreferredBoosterId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-sm text-white"
            >
              <option value="">Any available booster (fastest)</option>
              {boosters.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName}
                </option>
              ))}
            </select>
            {chosenBooster ? (
              <span className="mt-1 block text-zinc-500">
                Your booster gets the order first for a short time; if they do not take it, any booster can.
              </span>
            ) : null}
          </label>
        ) : null}
        {!signInRequired ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-zinc-400">
            <input
              type="checkbox"
              checked={riskAccepted}
              onChange={(e) => setRiskAccepted(e.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-orange-500"
            />
            <span>
              {RISK_DISCLOSURE_TEXT}{' '}
              <Link href="/terms" className="text-zinc-300 underline-offset-2 hover:underline" target="_blank">
                Terms
              </Link>
            </span>
          </label>
        ) : null}
        {signInRequired ? (
          <Link
            href={loginHref()}
            className="block w-full rounded-md bg-orange-500 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-orange-400"
          >
            Sign in to continue
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void continueToPayment()}
            // A quote error does not disable the button: clicking re-requests the quote.
            disabled={busy || !canOrder || missing.length > 0 || !riskAccepted}
            aria-busy={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            {buttonLabel}
          </button>
        )}
        {errorMsg ? (
          <p role="alert" className="text-center text-xs text-rose-400">
            {errorMsg}
          </p>
        ) : null}
        {testMode ? (
          <p className="text-center text-xs text-amber-400">Test mode: payments use Stripe test cards and no real money is charged.</p>
        ) : null}
        <p className="text-center text-xs text-zinc-500">Secure payment on Stripe · Price calculated by our server</p>
      </div>

      <ChampionsRolesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialValue={championsRolesByMode[mode]}
        onConfirm={(cfg) => {
          setChampionsRolesByMode((prev) => {
            const next = { ...prev, [mode]: cfg }
            remember({ championsRoles: next })
            return next
          })
          setModalOpen(false)
        }}
      />
    </div>
  )
}
