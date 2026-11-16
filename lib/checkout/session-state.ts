/**
 * Per-tab memory of the customer's checkout, keyed by game + service, so
 * going back (browser back, the step indicator, Stripe's "back" link, or a
 * sign-in round trip) restores the configuration instead of starting over.
 *
 * It also remembers the in-flight order attempt (idempotency key + the exact
 * request it was used for + the order id). Repeating "Continue to Payment"
 * for the same configuration therefore replays the SAME order on the server
 * (Idempotency-Key) instead of creating a duplicate.
 *
 * sessionStorage only (cleared when the tab closes); every access is guarded
 * because storage can be unavailable (private mode, blocked site data).
 * Nothing here is trusted by the server: prices and eligibility are always
 * recomputed there.
 */

export interface StoredCheckout {
  values?: Record<string, unknown>
  mode?: 'solo' | 'duo'
  extras?: { solo: Record<string, boolean>; duo: Record<string, boolean> }
  championsRoles?: Record<'solo' | 'duo', { roles: string[]; champions: string[] }>
  attempt?: { key: string; payloadJson: string; orderId?: string }
}

const PREFIX = 'lb:checkout:'
const keyFor = (gameSlug: string, serviceSlug: string) => `${PREFIX}${gameSlug}:${serviceSlug}`

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readCheckout(gameSlug: string, serviceSlug: string): StoredCheckout {
  try {
    const raw = storage()?.getItem(keyFor(gameSlug, serviceSlug))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as StoredCheckout) : {}
  } catch {
    return {}
  }
}

export function patchCheckout(gameSlug: string, serviceSlug: string, patch: Partial<StoredCheckout>) {
  try {
    const next = { ...readCheckout(gameSlug, serviceSlug), ...patch }
    storage()?.setItem(keyFor(gameSlug, serviceSlug), JSON.stringify(next))
  } catch {
    /* storage unavailable: the flow still works, only without restore */
  }
}

/** After a successful Stripe return, forget the attempt that created this order. */
export function clearAttemptForOrder(orderId: string) {
  const s = storage()
  if (!s) return
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i)
      if (!k?.startsWith(PREFIX)) continue
      const v = JSON.parse(s.getItem(k) ?? '{}') as StoredCheckout
      if (v.attempt?.orderId === orderId) s.setItem(k, JSON.stringify({ ...v, attempt: undefined }))
    }
  } catch {
    /* ignore */
  }
}

/** A fresh idempotency key (server pattern: [A-Za-z0-9_-]{16,128}). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
