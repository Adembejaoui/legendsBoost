# Order Creation Fix Report

Date: 2026-11-13. I traced the flow against your running dev server (`localhost:3000`) and ran the real server code against your real database. Only reads were done: no orders, payments, prices or ledger rows were written, and no Stripe charge or session was created.

## 1. Root cause

A customer is blocked by **three stacked problems**. Each one hides the next.

| # | Where it fails | What the customer sees | Underlying cause | Who fixes it |
|---|---|---|---|---|
| 1 | Service page, before any request | Disabled **"Under review"** button on all 14 services. No request is ever sent. | `.env.local` sets `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the `YOUR_KEY` placeholders. Next.js lets `.env.local` override `.env`, so your valid test key in `.env` is ignored. The payment mode becomes `unconfigured`, and the pending compliance status is only waived in **test** mode. | **You** (§3) |
| 2 | `POST /api/orders/quote` | **403** `{"error":"This service is not available for purchase yet."}` | Once problem 1 is fixed, eligibility passes, but the `servicePrice` table is **empty** (0 rows). The price lookup refused with **the same text** as the eligibility check, so the two causes couldn't be told apart. | Code: the message is now different. Prices: **your authorization** (§4). |
| 3 | Champion Mastery only, before the quote | "Missing required field: Champion" | **Code defect.** The service page didn't render `champion-picker` fields, so the required Champion couldn't be chosen. Fixed. | Fixed (§2) |

Payment confirmation will also fail after checkout until **problem 4** is fixed: `STRIPE_WEBHOOK_SECRET` in `.env` line 26 is not a `whsec_` signing secret. Stripe's real events would be rejected (400), and paid orders would stay `AWAITING_PAYMENT`.

### Evidence
- **Your running server.** `GET /games/league-of-legends/services/rank-boost`, `/valorant/services/win-boost` and `/teamfight-tactics/services/double-up-boost` all return HTTP 200 with the **"Under review"** button. "Review price" and the test-mode notice are absent.
- **`POST /api/orders/quote` without a session** returns **401**, as intended. I have no customer credentials, so the signed-in quote was reproduced by calling the same server function (`buildServerQuote`) with Next.js's own env loading:
  - **Env as the dev server loads it:** payment mode `unconfigured`. All 14 services return **403** "This service is not available for purchase yet." from eligibility.
  - **With `.env`'s test key in effect** (in memory only): payment mode `test`. All 14 still return **403** with the same text, now from the **price lookup**: 0 `servicePrice` rows.
- **Stripe authentication** (read-only balance read): `.env` key authenticated OK, `livemode=false`. `.env.local` key: placeholder.
- **Webhook check:** the endpoint is reachable and rejects a forged signature. The loaded secret is not in `whsec_` format.
- **Database:** 0 `servicePrice` rows, 1 commission policy (4500/5500), 0 ledger rows.

Browser console: not available to me (no browser session). The trace above reproduces each step's request and response directly.

## 2. Code changes

| File | Change | Why |
|---|---|---|
| [components/service-configurator/ServiceConfiguratorNew.tsx](../components/service-configurator/ServiceConfiguratorNew.tsx) | Renders `champion-picker`, `multi-select` and `checkbox` fields, using the existing `components/configurator` components. Before, only rank, select and number fields were drawn. | Champion Mastery's required Champion field could never be filled, so the order could never be submitted. Normal Matches' optional game-modes field was also missing. |
| [lib/pricing/service.ts](../lib/pricing/service.ts) | `NOT_PRICED_MESSAGE` is now **"No price is configured for this service yet."** | It used to be identical to the eligibility refusal, which hid the real cause. |
| [app/api/orders/quote/route.ts](../app/api/orders/quote/route.ts) | Logs `Quote refused` with the game, service, status and reason on 403/503, and `Quote failed` on 500. No user data or configuration values are logged. | There was no server-side trace of *why* a quote was refused. |
| [__tests__/checkout/configurator-payload.test.ts](../__tests__/checkout/configurator-payload.test.ts) (new) | Renders the real service page UI for all 14 services and fills every required field by clicking. It checks that the quote and order requests the browser actually sends pass the server's schema, validator and eligibility rule. | Route tests build payloads by hand and couldn't catch problem 3. **Proven:** with the fix removed, Champion Mastery fails (1 failed / 13 passed); with it, 14/14 pass. |
| `__tests__/payments/temporary-pricing.test.ts`, `__tests__/payments/catalog-purchase-e2e.test.ts` | Expect the new not-priced message | |

Unchanged:
- Server-side price calculation.
- Customer ownership checks.
- Idempotency.
- The rule that only the webhook marks an order paid.
- The unpaid-order restriction on the booster marketplace.
- 45/55.
- Ledger immutability.
- The eligibility rules.

I reviewed these and found no defects: the quote API, the order creation API and service, the order validator, the eligibility check, checkout session creation, and the review and payment pages (`/api/orders/[orderId]` returns the `pricing` / `paid` fields they read).

## 3. Environment: what you need to do

Variable names only are shown; no values were printed or changed.

| File | Line | Variable | State | Action |
|---|---|---|---|---|
| `.env.local` | 1 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | placeholder, overrides `.env` | **Delete the line** |
| `.env.local` | 2 | `STRIPE_SECRET_KEY` | placeholder, overrides `.env` | **Delete the line** |
| `.env.local` | 3–5 | `STRIPE_TEST_MODE`, `STRIPE_TEST_AMOUNT_CENTS`, `STRIPE_TEST_CURRENCY` | Not read by any code | Optional: delete |
| `.env` | 23 | `STRIPE_SECRET_KEY` | `sk_test_`, authenticates in test mode | Keep |
| `.env` | 28 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_` | Keep |
| `.env` | 26 | `STRIPE_WEBHOOK_SECRET` | Not a `whsec_` value | Replace with the secret from the Stripe CLI (below) |
| `.env` | 21 | `APP_URL` | `http://localhost:3000` | Keep |

These 5 lines are the whole of `.env.local`, so deleting the file has the same effect.

**Webhook secret:**
1. Install the Stripe CLI: `winget install --id Stripe.StripeCli`. Open a new terminal afterwards.
2. Run `stripe login`.
3. Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and keep it running.
4. Copy the `whsec_...` value it prints into `STRIPE_WEBHOOK_SECRET`, in `.env` line 26 or in `.env.local`.

**Then restart `npm run dev`.** To verify, run `node "C:\Users\tun\AppData\Local\Temp\claude\02e019d8352c5af5\c25fe85c-2d2d-404e-b9ce-9c546cf845e1\scratchpad\verify-webhook.mjs"`. It prints no secrets.

## 4. Pricing

| | |
|---|---|
| Rows in `servicePrice` | **0**. None of the 14 services has a price, so no rank, mode or option combination is priced. |
| Prepared temporary prices | 11 services ([lib/pricing/temporary-prices.ts](../lib/pricing/temporary-prices.ts)). **Not applied:** this needs your authorization. |
| Never priced (no price supplied) | LoL Arena Boost, LoL Normal Matches, VALORANT Unrated Matches |
| Pricing keys | Consistent. The quote API, the admin page and the admin writer all use `activeKey = "<gameSlug>:<serviceSlug>"`, with the same slugs as the catalog and the checkout config. |

**Requires your authorization.** Writing the 11 prices creates **11 `servicePrice` rows**, which can be replaced later, and **11 `financialAuditLog` rows**, which are **permanent**. Nothing else is written. The command, which defaults to a dry run:
```
npx tsx scripts/apply-temporary-prices.ts --list-admins
npx tsx scripts/apply-temporary-prices.ts --apply --admin-id <ADMIN_ID> --confirm-host aws-0-eu-west-1.pooler.supabase.com
```
The open price interpretations are listed in [FULL-CATALOG-TEMPORARY-PRICING-REPORT.md](FULL-CATALOG-TEMPORARY-PRICING-REPORT.md) §3–§4: flat $10 rank boosts, flat $8 placements, $0 duo and extras, and the 3 services without a price.

## 5. Tests

| Area | Test | Result |
|---|---|---|
| All 14 service quotes, invalid rank ranges, missing prices, order creation, Checkout preparation | `payments/temporary-pricing` (in-memory Postgres, fake Stripe client, `sk_test_` key, real catalog) | 53/53 pass. 34,140 configurations at the expected price; target ≤ current gives 400; 3 unpriced services give 403 "No price is configured…"; order 201 / 409; session `usd` with the server amount. |
| Browser → API payload | `checkout/configurator-payload` (new, jsdom) | 14/14 pass. Fails for Champion Mastery without the fix. |
| Webhook signature, duplicates, mismatches, delayed / failed / expired payments, 45/55 ledger | `payments/catalog-purchase-e2e` | 28/28 pass |
| Stripe authentication | Real read-only API call (balance read) | `.env` key OK, test mode. `.env.local` placeholder. |
| Webhook endpoint | `verify-webhook.mjs` against the dev server | Forged signature rejected (pass). Secret format: **fail** (not `whsec_`). |
| Full suite | `vitest run` | 679 passed, 20 failed. The 20 failures are all in 4 files that were already failing before this work: `security/rate-limit`, `security/sanitize`, `auth/password` (no suite), `assignments.service` pauseAssignment. |
| Type check / build | `tsc --noEmit`, `next build` | Clean / success |

**Not verified:** a real signed-in purchase in the browser. The tests use an in-memory database and a fake Stripe client. A real test-mode purchase still depends on §3 and §4.

## 6. Expected result after §3 and §4

1. Service pages show **"Review price"** and the test-mode notice.
2. The quote returns the USD price, for the 11 priced services.
3. Order creation returns 201 (`AWAITING_PAYMENT`, not visible to boosters).
4. The payment page redirects to Stripe Checkout (test mode).
5. With `stripe listen` running, a test-card payment is confirmed by the signed webhook. The order becomes `PENDING` and appears in the booster marketplace.

**Warning:** step 5 writes **permanent** ledger and snapshot rows to this database, and exposes the order to **real boosters**. Run it when no booster is active, or against a separate development database.
