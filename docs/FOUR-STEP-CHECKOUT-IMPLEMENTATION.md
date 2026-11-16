# Four-Step Checkout

Date: 2026-11-13.

**Choose Game → Choose Service → Configure Order → Pay with Stripe.** No customer-facing page sits between configuration and Stripe Checkout.

## 1. Previous flow (7 screens, 3 clicks after configuring)

| # | Screen | Friction |
|---|---|---|
| 1 | `/games`: game cards | Static "Coming soon" / "Available" badges, no service count |
| 2 | `/games/[game]`: large hero, "Explore services" button, then the service list further down, "How it works", FAQ | The service list sat below the fold. Cards only had a small "View details" link, with no price or status. |
| 3 | `/games/[game]/services/[service]`: configuration | Click 1: **"Review price"** (manual quote). Click 2: **"Confirm order and continue to payment"**. Unpriced services still offered the button. |
| 4 | `/checkout/review?id=`: review page | Click 3: **"Continue to Payment"** |
| 5 | `/checkout/payment?orderId=`: payment page | Click 4: **"Pay"**, which creates the Stripe session |
| 6 | Stripe Checkout | |
| 7 | `/checkout/success` or `/checkout/cancelled` | |

Sign-in always returned to `/dashboard`, so a signed-out customer lost their configuration.

## 2. New flow

| Step | Route | What the customer does |
|---|---|---|
| **1. Choose Game** | `/games` | Picks one of 3 game cards: image, name, "N services available", **Choose**. The whole card is the link. |
| **2. Choose Service** | `/games/[game]` | Sees only that game's services. Each card shows name, short description, **"From $X"** (server-calculated), and a status (Available / Price coming soon / Under review). Available cards are clickable; the others are shown greyed out, not as dead links. |
| **3. Configure Order** | `/games/[game]/services/[service]` | Fills the existing form: ranks and divisions, Solo/Duo, wins or matches, champion, extras. A **live order summary** shows the game, service, configuration, base price, each mode/option line and the total in USD, all from the **server quote API** (refreshed 350 ms after each change). One button: **Continue to Payment**. |
| **4. Payment** | Stripe-hosted Checkout | Pays. Returns to `/checkout/success` (status read from the webhook-verified backend) or `/checkout/cancelled` (retry, **Change configuration**, View order). |

A **4-step progress indicator** sits at the top of steps 1–3. Completed steps are links back.

### What "Continue to Payment" does ([CheckoutPanel.tsx](../components/checkout/CheckoutPanel.tsx))
1. **Validate:** required fields are checked in the browser. The server re-validates everything.
2. **Quote:** reuses the live quote for exactly this configuration, or requests it again.
3. **Create the order:** `POST /api/orders` with `expectedTotal` and an **Idempotency-Key**.
   - The key is bound to this exact request and the total shown.
   - It's stored per tab (sessionStorage), so a double click, a retry or coming back from Stripe **replays the same order**.
   - A synchronous guard also blocks clicks that arrive before the button re-renders as disabled.
4. **Start payment:** `POST /api/orders/:id/checkout` creates the Stripe session (existing service, existing Stripe idempotency key).
5. **Redirect:** `window.location.assign(stripeUrl)`.

**Failure handling:**
- **Stripe session fails:** the unpaid order is kept and the message says so. Pressing the same button again reuses the same key, so the same order gets a new or reused session.
- **409 (price changed):** the new price is fetched and shown. The old price is never charged, and the next attempt uses a new key.
- **401 (signed out):** the button becomes **"Sign in to continue"**, linking to `/login?callbackUrl=<this page>`. Selections survive the round trip, including through registration.
- **The replayed order is already paid or no longer payable:** a new order is created.

### Navigation
- Steps are real URLs with client-side `Link` navigation. Browser back and forward work, and old links to game and service pages still work.
- Selections (fields, mode, extras, champions/roles) are saved per game and service in sessionStorage. They're restored after browser back, the step indicator, Stripe's back link, the cancel page's "Change configuration" and sign-in.
- **Mobile:** the progress indicator shows only the current step's label on small screens. Cards stack in one column. Step 3 stacks the form above the summary (two columns from `lg`).

## 3. Routes and components

| File | Change |
|---|---|
| [app/games/page.tsx](../app/games/page.tsx) | Step 1: game cards with available-service count and a "Choose" action. Rendered per request. |
| [app/games/[gameSlug]/page.tsx](../app/games/[gameSlug]/page.tsx) | Step 2: the service grid is first. The large hero and "How it works" are removed; the FAQ and related games stay below. Rendered per request. |
| [app/games/[gameSlug]/services/[serviceSlug]/page.tsx](../app/games/[gameSlug]/services/[serviceSlug]/page.tsx) | Step 3: progress indicator. `purchase.orderable` now also requires an active price, so unpriced services show "Unavailable". Rendered per request. |
| [components/checkout/CheckoutPanel.tsx](../components/checkout/CheckoutPanel.tsx) | Rewritten: live quote, price breakdown, single CTA, idempotent order, Stripe redirect, recovery, sign-in, restore. |
| [components/checkout/CheckoutSteps.tsx](../components/checkout/CheckoutSteps.tsx) (new) | 4-step indicator |
| [components/games/ServiceCard.tsx](../components/games/ServiceCard.tsx), [ServiceGrid.tsx](../components/games/ServiceGrid.tsx) | Whole-card selection, "From $X", status |
| [lib/catalog/storefront.ts](../lib/catalog/storefront.ts) (new), [storefront-types.ts](../lib/catalog/storefront-types.ts) (new) | Read-only. Per service: eligible + priced, and the starting price from the **real pricing engine** on the cheapest valid configuration, so the badge can't disagree with the quote API. |
| [lib/checkout/session-state.ts](../lib/checkout/session-state.ts) (new), [lib/checkout/redirect.ts](../lib/checkout/redirect.ts) (new) | Per-tab selection and attempt memory; the Stripe redirect |
| [components/service-configurator/ServiceConfiguratorNew.tsx](../components/service-configurator/ServiceConfiguratorNew.tsx) | Saves and restores field values |
| [components/payment/CheckoutReturn.tsx](../components/payment/CheckoutReturn.tsx) | Success: forgets the attempt, so the next order is new. Cancelled: adds a **Change configuration** link. |
| [lib/auth/safe-callback.ts](../lib/auth/safe-callback.ts) (new), [components/auth/login-form.tsx](../components/auth/login-form.tsx), [register-form.tsx](../components/auth/register-form.tsx) | `callbackUrl` support (same-site relative paths only, so it can't be used as an open redirect), passed through login ↔ register and Google sign-in |

**Unchanged:**
- The pricing engine, quote, order and checkout APIs.
- Order creation and idempotency.
- Webhook payment verification.
- The ledger and the 45/55 commission.
- The booster marketplace (unpaid orders stay unclaimable).
- Assignments.

## 4. Removed or consolidated

| Page | Now |
|---|---|
| `/checkout/review` (review-client.tsx deleted) | Removed from the flow. Old links redirect: `?id=X` goes to `/checkout/payment?orderId=X`, otherwise to `/games`. |
| `/checkout/payment` | No longer part of the flow. Kept only to resume payment of an existing unpaid order from old links. |
| "Review price" + "Confirm order" buttons | Replaced by the live quote and the single "Continue to Payment" |
| `GameHero`, `GameServiceSection`, `HowItWorks` on the game page | No longer rendered there. The components remain in the codebase. |

## 5. Tests

| Test | Result |
|---|---|
| [__tests__/checkout/configurator-payload.test.ts](../__tests__/checkout/configurator-payload.test.ts): the **real step 3 UI** for **all 14 services**, filled by clicking like a customer, with a fake backend | **20/20 pass.** Covered: live quote with breakdown; the request passes the server's schema, validator and eligibility rule; one click gives order → Stripe session → redirect with nothing in between; the order body equals the quoted configuration plus `expectedTotal`; the Idempotency-Key format; no navigation to a review or payment page. |
| Same file, edge cases | Triple click: 1 order, 1 session. Stripe session 502 then retry: **same Idempotency-Key, same order**. Back navigation (remount): selections restored, same order replayed. 401: "Sign in to continue" with `callbackUrl`. 409: new price shown, new key. Unpriced service: "Unavailable", no requests. |
| [__tests__/checkout/storefront.test.ts](../__tests__/checkout/storefront.test.ts) | 19/19 pass. "From" prices for the 11 priced services ($10 / $3 / $8 / $5) match the engine. `safeCallbackPath` rejects `https://…`, `//…`, `/\…`, `javascript:` and relative paths without a leading `/`. |
| Existing quote → order → checkout route tests (`payments/temporary-pricing`, `payments/catalog-purchase-e2e`), in-memory Postgres and fake Stripe | Pass, unchanged: 45/55 snapshot, unpaid orders not claimable, webhook signature checks |
| Full suite | **704 passed, 20 failed.** The 20 failures are all in 4 files that were already failing before this work: `security/rate-limit`, `security/sanitize`, `auth/password` (no suite), `assignments.service` pauseAssignment. |
| `tsc --noEmit`, `next build` | Clean, success. `/games`, `/games/[game]` and `/games/[game]/services/[service]` are dynamic. |
| Smoke test against the running dev server (`GET` requests only, nothing written) | `/games`: LoL 4, TFT 4, VALORANT 3 services available. Game pages show "From $10.00 / $3.00 / $8.00 / $5.00" and the 3 unpriced services as non-selectable. LoL Rank Boost has "Continue to Payment" and the test-mode notice. LoL Arena Boost shows "Unavailable — Pricing for this service is not available yet". `/checkout/review?id=…` returns 307. |

No order, payment, Stripe session or database write was made against the real database or Stripe.

## 6. Remaining limitations

1. **No real end-to-end purchase was run.** Doing so would create a real order in your database (not authorized), and payment confirmation still needs `STRIPE_WEBHOOK_SECRET` from `stripe listen`. The redirect was tested with a fake backend; the routes with an in-memory database and fake Stripe.
2. **Mobile layout wasn't checked in a real browser.** It relies on the responsive layout classes described in §2; I had no browser available.
3. **The live price needs sign-in.** The quote API is limited to signed-in customers, which is unchanged. Signed-out visitors see "From $X" on step 2, and "Sign in to continue" on step 3 with their selections kept.
4. **Changing the configuration after an order was created starts a new order.** The earlier one stays unpaid (`AWAITING_PAYMENT`). It's never visible to boosters, and the customer can pay or cancel it from the dashboard.
5. **Pages are now rendered on every request**, with one small read-only database query for prices on steps 1–3, because availability and starting prices depend on live prices and the Stripe mode.
6. **Unused components remain in the codebase:** `GameHero`, `GameServiceSection`, `components/service-configurator/CheckoutPanel.tsx` and `/checkout/payment`.
