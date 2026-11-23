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
import { Link } from "@/i18n/navigation";
import Image from 'next/image'
import { ArrowRight, Loader2, Lock, ShoppingCart, User, UserRound, Users } from 'lucide-react'
import { CheckoutOptionRow } from './CheckoutOptionRow'
import { ChampionsRolesModal } from './ChampionsRolesModal'
import { champions as championCatalog } from '@/lib/catalog/champions'
import { getTier } from '@/lib/catalog/rank-systems'
import { getCheckoutConfig, getCheckoutOptionsForMode } from '@/lib/config/checkout-options'
import { formatMoney } from '@/lib/money'
import { evaluateOrderEligibility } from '@/lib/orders/order-eligibility'
import { newIdempotencyKey, patchCheckout, readCheckout, type StoredCheckout } from '@/lib/checkout/session-state'
import { PREFERRED_BOOSTER_KEY } from '@/components/boosters/ChooseBoosterButton'
import { redirectToStripeCheckout } from '@/lib/checkout/redirect'
import { useTranslations } from 'next-intl'
import { rankLabel, useCatalogText } from '@/lib/i18n/catalog'
import { useCurrency } from '@/lib/currency/client'

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
  /** Price of every extra of the selected mode (shown before it is switched on). */
  optionAmounts?: Record<string, number>
}
type QuoteOutcome = { kind: 'ok'; quote: ServerQuote } | { kind: 'error'; error: string } | { kind: 'signin' }
type QuoteResult = QuoteOutcome & { payloadJson: string }
type Phase = 'idle' | 'quoting' | 'creating' | 'paying' | 'redirecting'

const QUOTE_DEBOUNCE_MS = 350

async function requestQuote(payloadJson: string, fallbackError: string, signal?: AbortSignal): Promise<QuoteOutcome> {
  const res = await fetch('/api/orders/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadJson, signal })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) return { kind: 'signin' }
  if (!res.ok) return { kind: 'error', error: data.error || fallbackError }
  return { kind: 'ok', quote: data.quote as ServerQuote }
}

function loginHref() {
  const path = typeof window === 'undefined' ? '/games' : window.location.pathname
  return `/login?callbackUrl=${encodeURIComponent(path)}`
}

export function CheckoutPanel({ game, offer, values, rankSystems, onOrderCreated }: CheckoutPanelProps) {
  const t = useTranslations('Checkout')
  const ct = useCatalogText()
  // Priced and charged in the visitor's currency (header picker).
  const currency = useCurrency()
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
  // No risk checkbox at checkout (client decision 2026-11-19).
  const [otpModalOpen, setOtpModalOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [boosterPickerOpen, setBoosterPickerOpen] = useState(false)
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
    if (option?.configurationType === 'otp-champion') {
      if (on) setOtpModalOpen(true)
      else setOtpChampion(undefined)
    }
  }
  const setOtpChampion = (champion: string | undefined) => {
    setChampionsRolesByMode((prev) => {
      const next = { ...prev, [mode]: { ...prev[mode], otpChampion: champion } }
      remember({ championsRoles: next })
      return next
    })
  }

  // Badges come from the real configured price; an extra with no price is
  // hidden (the server would refuse it). Without a price list (unpriced
  // service) nothing is purchasable anyway, so the catalog badges are kept.
  const priceTags = offer.priceTags as { options: Record<string, string>; modes: Record<string, string> } | null | undefined
  const visibleOptions = (config ? getCheckoutOptionsForMode(config, mode) : [])
    .filter((o) => !priceTags || o.id in priceTags.options)
    .map((o) => (priceTags ? { ...o, badge: priceTags.options[o.id] } : o))
    // Shown texts in the visitor's language (the id is what is sent).
    .map((o) => ({ ...o, label: ct(o.label), description: o.description && ct(o.description), descriptionDuo: o.descriptionDuo && ct(o.descriptionDuo) }))

  const summaryLines = useMemo(() => {
    const lines: { key: string; label: string; value: string; iconSrc?: string }[] = []
    for (const field of offer.fields || []) {
      const raw = values[field.key]
      if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue
      if (field.type === 'rank-picker') {
        const sel = raw as { tierId: string; divisionId: string | null }
        const sys = field.rankSystemId ? rankSystems.find((s) => s.id === field.rankSystemId) : undefined
        const tier = sys && sel ? getTier(sys.id, sel.tierId) : undefined
        lines.push({ key: field.key, label: field.label, value: sys ? rankLabel(ct, sys.id, sel) : `${sel.tierId}`, iconSrc: tier?.iconSrc })
      } else if (field.type === 'select' || field.type === 'multi-select') {
        const opts: { label: string; value: string }[] = field.options ?? []
        const label = (v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v)
        lines.push({ key: field.key, label: field.label, value: Array.isArray(raw) ? raw.map(label).join(', ') : label(raw) })
      } else if (field.type === 'checkbox') {
        lines.push({ key: field.key, label: field.label, value: raw ? t('yes') : t('no') })
      } else {
        lines.push({ key: field.key, label: field.label, value: String(raw) })
      }
    }
    return lines
  }, [values, offer, rankSystems, ct, t])

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
    championsRoles: (() => {
      // The OTP champion is only sent while "OTP Champ Only" is selected.
      const { otpChampion, ...rest } = championsRolesByMode[mode]
      return selectedOptions.includes('otp-champion') && otpChampion ? { ...rest, otpChampion } : rest
    })(),
    ...(couponCode ? { couponCode } : {}),
    currency,
  }
  const payloadJson = JSON.stringify(payload)
  const ready = canOrder && missing.length === 0

  // Live quote: refresh (debounced) whenever the complete configuration changes.
  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      requestQuote(payloadJson, t('priceError'), ctrl.signal)
        .then((r) => {
          setQuoteResult({ ...r, payloadJson } as QuoteResult)
          // A code the server refused is shown with its reason and not sent
          // again, so the order goes ahead at the normal price.
          const c = r.kind === 'ok' ? r.quote.coupon : null
          if (c && !c.applied) {
            setCouponCode(null)
            setLastCouponError(`${c.code}: ${c.reason ?? t('notValid')}`)
          }
        })
        .catch((e) => {
          if ((e as Error)?.name !== 'AbortError') setQuoteResult({ payloadJson, kind: 'error', error: t('priceErrorNetwork') })
        })
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [payloadJson, ready, quoteNonce, t])

  // Boosters the customer may choose for this exact configuration.
  const boosterKey = JSON.stringify({ gameSlug: game.slug, serviceSlug: offer.serviceSlug, configuration: values })
  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch('/api/checkout/preferred-boosters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: boosterKey, signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { boosters: [] }))
        .then((d: { boosters?: { id: string; displayName: string }[] }) => setBoosters(d.boosters ?? []))
        .catch(() => {})
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
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
    if (!canOrder) return fail(offer.purchase?.reason === 'unpriced' ? t('unpriced') : t('notPurchasable'))
    if (missing.length) return fail(t('complete', { fields: missing.join(', ') }))

    try {
      // 2. Quote for exactly this configuration (fresh, or refreshed now).
      let q = quote
      if (!q) {
        setPhase('quoting')
        const r = await requestQuote(payloadJson, t('priceError'))
        setQuoteResult({ ...r, payloadJson } as QuoteResult)
        if (r.kind === 'signin') {
          setNeedsSignIn(true)
          return fail(t('signInToPay'))
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
        return fail(t('signInToPay'))
      }
      if (res.status === 409) {
        // Price changed since it was shown: show the new price, never charge the old one.
        setQuoteResult(null)
        setQuoteNonce((n) => n + 1)
        attemptRef.current = undefined
        remember({ attempt: undefined })
        return fail(data.error || t('priceChanged'))
      }
      if (!res.ok || !data.order?.id) return fail(data.error || t('orderFailed'))
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
          `${coData.error || t('paymentFailed')} ${t('paymentRetry')}`,
        )
      }

      // 5. Redirect to Stripe (step 4). The button stays disabled.
      setPhase('redirecting')
      redirectToStripeCheckout(coData.url)
    } catch {
      fail(t('network'))
    }
  }

  const busy = phase !== 'idle'
  const buttonLabel =
    phase === 'quoting' ? t('quoting')
    : phase === 'creating' ? t('creating')
    : phase === 'paying' ? t('paying')
    : phase === 'redirecting' ? t('redirecting')
    : canOrder ? t('buyNow')
    : t('unavailable')

  // Headline: current rank -> target rank, or the quantity bought.
  const fieldOf = (key: string) => (offer.fields || []).find((x: { key: string }) => x.key === key)
  // Champion Mastery: "Jinx" -> "Level 4 -> Level 6" (client PDF 2026-11-19).
  const masteryChampion = typeof values.champion === 'string' ? championCatalog.find((c) => c.id === values.champion) : undefined
  const levels =
    typeof values.currentLevel === 'number' && typeof values.targetLevel === 'number'
      ? t('levels', { from: values.currentLevel, to: values.targetLevel })
      : null
  const fromLine = masteryChampion
    ? { key: 'champion', label: t('champion'), value: masteryChampion.name, iconSrc: masteryChampion.iconSrc }
    : summaryLines.find((l) => l.key === 'currentRank')
  const toLine =
    (levels ? { key: 'levels', label: t('mastery'), value: levels, iconSrc: undefined } : undefined) ??
    summaryLines.find((l) => l.key === 'targetRank') ??
    (() => {
      const unitField = (offer.fields || []).find((x: { type: string; key: string }) => x.type === 'number' && values[x.key] != null && values[x.key] !== '')
      if (!unitField) return undefined
      const plural = (fieldOf(unitField.key) as { unit?: string } | undefined)?.unit ?? ''
      // "1 win", "3 wins" (also "1 victoire", "3 victoires")
      const unit = Number(values[unitField.key]) === 1 && plural.endsWith('s') ? plural.slice(0, -1) : plural
      return { key: unitField.key, label: unitField.label, value: `${values[unitField.key]} ${unit}`.trim(), iconSrc: undefined }
    })()

  const priceLabelFor = (o: CheckoutOption): string | undefined => {
    const amount = quote?.optionAmounts?.[o.id]
    if (amount !== undefined && quote) return amount === 0 ? 'Free' : `+${formatMoney(amount, quote.currency)}`
    return o.badge === 'Free' ? 'Free' : quoteLoading ? undefined : o.badge
  }
  const mainOptions = visibleOptions.filter((o) => o.group !== 'secondary')
  const secondaryOptions = visibleOptions.filter((o) => o.group === 'secondary')
  const modeChoices = priceTags ? enabledModes.filter((m) => m.id in priceTags.modes) : enabledModes
  const chosenName = boosters.find((b) => b.id === chosenBooster)?.displayName
  const optionRow = (option: CheckoutOption) => (
    <CheckoutOptionRow
      key={`${game.slug}-${offer.serviceSlug}-${option.id}-${mode}`}
      option={option}
      mode={mode}
      checked={extrasByMode[mode]?.[option.id] ?? false}
      onToggle={(v) => toggleExtra(option.id, Boolean(v))}
      priceLabel={priceLabelFor(option)}
      disabled={option.enabled === false || busy}
      championsRoles={championsRolesByMode[mode]}
      onConfigure={
        option.configurationType === 'champions-roles'
          ? () => setModalOpen(true)
          : option.configurationType === 'otp-champion'
            ? () => setOtpModalOpen(true)
            : undefined
      }
    />
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111319]">
      <div className="flex items-center gap-2 px-4 pt-4">
        <ShoppingCart className="size-4 text-orange-400" aria-hidden />
        <h2 className="text-base font-semibold text-white">{t('orderSummary')}</h2>
      </div>

      <div className="space-y-3 p-4">
        {fromLine || toLine ? (
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            {fromLine?.iconSrc ? <Image src={fromLine.iconSrc} alt="" width={36} height={36} className="size-9 object-contain" /> : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{fromLine?.value ?? offer.title}</p>
              <p className="text-[11px] text-zinc-500">{fromLine ? fromLine.label : game.name}</p>
            </div>
            {toLine ? (
              <>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-300">
                  <ArrowRight className="size-3.5" aria-hidden />
                </span>
                <div className="flex min-w-0 items-center gap-2 text-right">
                  {toLine.iconSrc ? <Image src={toLine.iconSrc} alt="" width={36} height={36} className="size-9 object-contain" /> : null}
                  <p className="truncate text-sm font-bold text-white">{toLine.value}</p>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {modeChoices.length > 1 ? (
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/20 p-1" role="radiogroup" aria-label={t('sessionType')}>
            {modeChoices.map((m) => {
              const active = m.id === mode
              const Icon = m.id === 'duo' ? Users : User
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => changeMode(m.id as CheckoutMode)}
                  disabled={busy}
                  className={
                    'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:text-[13px] ' +
                    (active ? 'bg-orange-500 text-white shadow' : 'text-zinc-400 hover:text-white')
                  }
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{ct(m.label)}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {visibleOptions.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-1">
            {mainOptions.map(optionRow)}
            {mainOptions.length > 0 && secondaryOptions.length > 0 ? <div className="my-1 border-t border-white/10" /> : null}
            {secondaryOptions.map(optionRow)}
          </div>
        ) : null}

        {!signInRequired ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-orange-500/15 text-orange-300">
                <UserRound className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-500">{t('handledBy')}</p>
                <p className="truncate text-sm font-semibold text-white">{chosenName ?? t('anyone')}</p>
              </div>
              {boosters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setBoosterPickerOpen((v) => !v)}
                  aria-expanded={boosterPickerOpen}
                  className="text-xs font-semibold text-orange-300 hover:text-orange-200"
                >
                  {t('change')}
                </button>
              ) : null}
            </div>
            {boosterPickerOpen && boosters.length > 0 ? (
              <div className="mt-2 space-y-1 border-t border-white/10 pt-2" role="radiogroup" aria-label={t('booster')}>
                {[{ id: '', displayName: t('anyoneFastest') }, ...boosters].map((b) => (
                  <button
                    key={b.id || 'any'}
                    type="button"
                    role="radio"
                    aria-checked={chosenBooster === b.id}
                    onClick={() => {
                      setPreferredBoosterId(b.id)
                      setBoosterPickerOpen(false)
                    }}
                    className={
                      'block w-full rounded-md px-2 py-1.5 text-left text-sm ' +
                      (chosenBooster === b.id ? 'bg-orange-500/15 text-white' : 'text-zinc-300 hover:bg-white/5')
                    }
                  >
                    {b.displayName}
                  </button>
                ))}
                <p className="px-2 text-[11px] text-zinc-500">{t('boosterNote')}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-white/10 pt-3" aria-live="polite">
          {quote?.discountAmount && quote.coupon?.applied ? (
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-emerald-300">{t('discount', { code: quote.coupon.code })}</span>
              <span className="text-emerald-300">-{formatMoney(quote.discountAmount, quote.currency)}</span>
            </div>
          ) : null}
          <p className="text-[11px] text-zinc-500">{t('totalPrice')}</p>
          <p className="flex items-center gap-2 text-3xl font-black tracking-tight text-white">
            {quoteLoading ? <Loader2 className="size-5 animate-spin text-zinc-400" aria-label={t('calculatingAria')} /> : null}
            {quote ? formatMoney(quote.totalAmount, quote.currency) : '—'}
          </p>
          {!quote || missing.length || signInRequired || current?.kind === 'error' || !canOrder ? (
            <p className="mt-0.5 text-xs text-zinc-500">
              {!canOrder
                ? offer.purchase?.reason === 'unpriced'
                  ? t('unpriced')
                  : t('notPurchasable')
                : missing.length
                  ? t('completeShort', { fields: missing.join(', ') })
                  : signInRequired
                    ? t('signInForPrice')
                    : current?.kind === 'error'
                      ? current.error
                      : t('calculating')}
            </p>
          ) : null}

          {discountOpen || couponCode ? (
            <form
              className="mt-2 flex gap-2"
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
                placeholder={t('discountCode')}
                maxLength={32}
                aria-label={t('discountCode')}
                autoFocus={!couponCode}
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
                  {t('remove')}
                </button>
              ) : (
                <button type="submit" disabled={!couponDraft.trim() || busy} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-50">
                  {t('apply')}
                </button>
              )}
            </form>
          ) : (
            <button type="button" onClick={() => setDiscountOpen(true)} className="mt-1 text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
              {t('haveCode')}
            </button>
          )}
          {lastCouponError ? <p role="alert" className="mt-1 text-xs text-amber-300">{lastCouponError}</p> : null}
        </div>

        {signInRequired ? (
          <Link
            href={loginHref()}
            className="block w-full rounded-xl bg-orange-500 px-4 py-3 text-center text-sm font-bold text-white hover:bg-orange-400"
          >
            {t('signInContinue')}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void continueToPayment()}
            // A quote error does not disable the button: clicking re-requests the quote.
            disabled={busy || !canOrder || missing.length > 0}
            aria-busy={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            {busy ? buttonLabel : canOrder ? t('buyNow') : t('unavailable')}
          </button>
        )}
        {errorMsg ? (
          <p role="alert" className="text-center text-xs text-rose-400">
            {errorMsg}
          </p>
        ) : null}
        {testMode ? <p className="text-center text-xs text-amber-400">{t('testMode')}</p> : null}
        <p className="text-center text-[11px] text-zinc-500">{t('secure')}</p>
      </div>

      <ChampionsRolesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialValue={championsRolesByMode[mode]}
        onConfirm={(cfg) => {
          setChampionsRolesByMode((prev) => {
            const next = { ...prev, [mode]: { ...cfg, otpChampion: prev[mode].otpChampion } }
            remember({ championsRoles: next })
            return next
          })
          setModalOpen(false)
        }}
      />
      <ChampionsRolesModal
        single
        open={otpModalOpen}
        onClose={() => setOtpModalOpen(false)}
        initialValue={{ roles: [], champions: championsRolesByMode[mode].otpChampion ? [championsRolesByMode[mode].otpChampion as string] : [] }}
        onConfirm={(cfg) => {
          setOtpChampion(cfg.champions[0])
          setOtpModalOpen(false)
        }}
      />
    </div>
  )
}
