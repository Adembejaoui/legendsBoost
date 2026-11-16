# Full Catalog Activation and Temporary Pricing

Date: 2026-11-13. Scope: League of Legends, Teamfight Tactics and VALORANT, with 14 services in total.

## 1. Summary

| | Status |
|---|---|
| All 3 games visible, all 14 services published and configurable | **Done** (code) |
| Compliance approval | **Not given.** Every service remains `complianceStatus: 'pending-review'`. |
| Purchasable with Stripe **test** keys | **Yes**, once the prices are in the database (see §6) |
| Purchasable with Stripe **live** keys | **No.** Compliance approval is still required. |
| Temporary prices written to the database | **No.** Waiting for your confirmation (§6). |
| Services priced | 11 of 14. Arena Boost, Normal Matches and VALORANT Unrated Matches have no price yet (§4). |
| Real Stripe test payment | Not performed (as instructed) |

**This is not ready for live purchases.** Selling for real still needs final prices, compliance approval and a live payment setup.

## 2. Publication versus compliance

Before this change, a single set of flags meant both "published" and "approved". Every service was `pending-review` / `draft-only` / `allowOrder: false`, so nothing could be bought.

The check now treats these as two separate gates ([lib/orders/order-eligibility.ts](../lib/orders/order-eligibility.ts)):

| Gate | Flags | Now |
|---|---|---|
| Publication (technical readiness) | `availability`, `orderCapability`, `allowOrder` | `available`, `live-order`, `true` for all 14 |
| Compliance (legal / publisher) | `complianceStatus` | Still `pending-review` for all 14. Unchanged, and not presented as approved. |

How the compliance gate behaves:
- **`rejected`:** ordering is always blocked.
- **`pending-review`:** every **real** sale is blocked. The gate is waived only while `STRIPE_SECRET_KEY` is a test key (`sk_test_` / `rk_test_`), where no real money can be charged.
- **Missing, placeholder or live key:** the strict rule applies.
- **The mode is read from the key prefix only** ([lib/stripe/mode.ts](../lib/stripe/mode.ts)).

The rule is enforced in three places:
1. The quote API.
2. Order creation.
3. **Stripe Checkout** ([lib/payments/checkout.service.ts](../lib/payments/checkout.service.ts)). The checkout step re-checks eligibility under the current mode. An order created in test mode therefore can't be paid with real money if live keys are added later. It gets a 403.

What customers see:
- **Service page:** the checkout button uses the server's own result (`getPurchaseStatus`). When the waiver applies, the panel says: *"Test mode: payments use Stripe test cards and no real money is charged."*
- **Game badges:** these were hard-coded as "Coming soon" or "Eligibility under review". They're now computed on the games list, the game pages and the home page: "Available" if at least one service can be ordered, otherwise "Under review".

## 3. Temporary prices: currency and pricing model

- **Currency:** USD, stored as integer cents.
  - The Stripe session is created in `usd` with the exact snapshot amount.
  - Each price stores its own currency, and each order's snapshot keeps it.
  - The `EUR` default in the admin price form, and the EUR fallback in two money-display components, are display defaults only. They don't affect amounts.
- **Who calculates the price:** the server, always from the stored `ServicePrice` row, through the unchanged engine ([lib/pricing/engine.ts](../lib/pricing/engine.ts)).
  - Customers can't submit a price: `price` or `totalAmount` in a request gets a 400.
  - `expectedTotal` must match the server's quote, otherwise 409.
- **No fallback:** an unpriced service, tier, mode or option is refused (403). Every amount below is stored explicitly.

| # | Service (game / slug) | Owner's price | Stored as | Rank steps | Modes | Enabled options |
|---|---|---|---|---|---|---|
| 1 | LoL / `rank-boost` | Rank Boost $10 | RANK_STEPS, base **$10.00** | every tier $0 | solo $0, duo $0 | challenger-booster $0 |
| 2 | LoL / `win-boost` | Win Boost $3 per win | PER_UNIT `wins`, base $0, **$3.00 / win** | n/a | solo $0, duo $0 | none enabled |
| 3 | LoL / `placement-boost` | Placement Matches $8 | FIXED **$8.00** | n/a | solo $0 | none |
| 4 | LoL / `arena-boost` | none given | **unpriced** | | none | none |
| 5 | LoL / `normal-matches` | none given | **unpriced** | | none | none |
| 6 | LoL / `champion-mastery` | Champion Mastery $5 | FIXED **$5.00** | n/a | solo $0, duo $0 | 7 options, all $0 |
| 7 | VALORANT / `rank-boost` | VALORANT Rank Boost $10 | RANK_STEPS, base **$10.00** | every tier $0 | solo $0, duo $0 | none |
| 8 | VALORANT / `win-boost` | VALORANT Win Boost $3 per win | PER_UNIT `wins`, base $0, **$3.00 / win** | n/a | none | none |
| 9 | VALORANT / `placement-boost` | Placement Matches $8 | FIXED **$8.00** | n/a | none | none |
| 10 | VALORANT / `unrated-matches` | none given | **unpriced** | | solo, duo | 8 options |
| 11 | TFT / `rank-boost` | TFT Rank Boost $10 | RANK_STEPS, base **$10.00** | every tier $0 | solo $0 | none |
| 12 | TFT / `win-boost` | Win Boost $3 per win | PER_UNIT `wins`, base $0, **$3.00 / win** | n/a | none | none |
| 13 | TFT / `placement-boost` | Placement Matches $8 | FIXED **$8.00** | n/a | none | none |
| 14 | TFT / `double-up-boost` | TFT Double Up $10 | RANK_STEPS, base **$10.00** | every tier $0 | solo $0, duo $0 | 8 options, all $0 |

The values are defined in [lib/pricing/temporary-prices.ts](../lib/pricing/temporary-prices.ts). The running app never reads that file; only the apply script does.

### Interpretations to confirm
These are literal readings of your list. Each one is a single line in `temporary-prices.ts`.
1. **Rank boosts and Double Up: "$10" is read as a flat base price.** No price per division was given, so every tier step is an explicit $0. Iron IV → Master costs $10, the same as one division. The other reading is $10 per division (`stepAmount: 1000`).
2. **Placements: "$8" is read as a flat price per order**, whatever the number of placement matches. The other reading is $8 per match (`PER_UNIT` on `placementsRemaining`).
3. **Modes and extras: none were given**, so duo mode and every enabled extra are an explicit $0 ("included"). Without this, those combinations couldn't be ordered at all.

## 4. Unresolved pricing

| Item | Why it's unresolved |
|---|---|
| LoL Arena Boost (`arenaWins` 1–50) | No price in your list. It's a separate service from Win Boost. |
| LoL Normal Matches (`matches` 1–50) | No price in your list. |
| VALORANT Unrated Matches (`matches` 1–50, solo/duo, 8 options) | No price in your list. |
| "Coaching: $10" | There's no coaching service among the 14. The coaching pages in `lib/games.ts` ("from $99") aren't rendered by any route. The options of Champion Mastery, Unrated Matches and Double Up read like coaching extras (session scheduling, coaching time, replay analysis). If "Coaching $10" was meant for one of those services, say which. |
| Disabled options with % badges (e.g. Priority +25%, Hidden Duo +25%) | They can't be selected (the server rejects them), so they're left unpriced. They need real percentages before they're enabled. |

These 3 services are visible and configurable. A quote for them returns *"This service is not available for purchase yet."* (403), and no order can be created. **Known mismatch:** their checkout button still shows "Review price" before it returns that error. The static page can't know whether a database price exists. The mismatch disappears once they're priced.

## 5. Stripe integration (unchanged, checked)

| Requirement | Evidence |
|---|---|
| Checkout charges the server-calculated total | The session amount comes only from the order's price snapshot. Tests check `unit_amount` = the server total for every priced service. |
| Currency and amount | Tests check `currency: "usd"` and the exact amount in cents. |
| Test keys used locally | `.env` has `sk_test_` / `pk_test_`. Live keys are still refused unless `STRIPE_LIVE_MODE_ENABLED="true"`. **But** `.env.local` still sets `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the `YOUR_KEY` placeholders, and `.env.local` overrides `.env`. Until you remove those two lines, the app treats Stripe as unconfigured and every service shows "Under review". The build confirmed this. |
| Webhook signature verification | Not modified: raw body plus `STRIPE_WEBHOOK_SECRET` |
| Only verified, paid orders reach the booster marketplace | Unchanged (`paymentVerifiedAt` is set only by the webhook). Tests confirm unpaid orders aren't listed. |
| Idempotency and duplicate-webhook protection | Unchanged. The existing 28-test end-to-end suite still passes. |
| 45/55 commission and immutable ledger | Unchanged. The database holds one policy, 4500/5500. Snapshots in the tests are 4500/5500, and fee + share = total for every price. No ledger code was modified. |

## 6. Database changes required (awaiting your confirmation)

**Target:** Supabase `aws-0-eu-west-1.pooler.supabase.com`, database `postgres`. I treat it as **production**: it has real users and 10 existing orders.

**Current state** (read-only check):
- 0 `servicePrice` rows.
- 1 `commissionPolicy` (4500/5500).
- 3 admin accounts.
- 0 ledger rows.

**Exactly what would be written:**

| Table | Rows | Content | Reversible? |
|---|---|---|---|
| `servicePrice` | **11 inserted** | One per priced service, `version 1`, `status ACTIVE`, `activeKey "<game>:<service>"`, USD, the amounts in §3, `createdById` = the admin you choose | Yes: retiring a price or saving a new version retires it. The row stays as history. |
| `financialAuditLog` | **11 inserted** | `action SERVICE_PRICE_CREATED`, `entityType servicePrice`, `details.input` including `note: "TEMPORARY test price …"` | **No.** The table is append-only (trigger), so these rows are permanent. |

Nothing else is touched: no orders, payments, snapshots, ledger, users, commission policy or migrations. The script never overwrites an existing active price; it skips that service.

**Command, to run once confirmed** (the default is a dry run with no writes; it was run and printed the 11 planned rows):
```
npx tsx scripts/apply-temporary-prices.ts --list-admins
npx tsx scripts/apply-temporary-prices.ts --apply --admin-id <ADMIN_ID> --confirm-host aws-0-eu-west-1.pooler.supabase.com
```
The script writes through the same admin service as the dashboard (`createServicePriceVersion`): catalog validation, versioning and an audit row ([scripts/apply-temporary-prices.ts](../scripts/apply-temporary-prices.ts)).

**Warning about test purchases on this database:** after the prices exist, a test-card payment that reaches the webhook (via `stripe listen`) marks a real order row as paid. That order then appears in the **real booster marketplace**, and its ledger rows and price snapshot are **permanent**. Do test purchases when no real booster is active, or use a separate development database.

## 7. Test results

New test: [__tests__/payments/temporary-pricing.test.ts](../__tests__/payments/temporary-pricing.test.ts), 53 tests, all passing. It runs on the **real** catalog (compliance still pending, nothing overridden), an in-memory PostgreSQL with the real migrations, and a fake Stripe client with a `sk_test_` key and no network.

| Check | Result |
|---|---|
| Catalog visibility and flags (14 services) | Pass. Published, compliance pending. |
| Eligibility | Pass for all 14: allowed in test mode, refused with live or unconfigured keys, refused when `rejected`. |
| Admin inputs | Pass for all 11: valid against the catalog, USD, integer cents, marked TEMPORARY. |
| **Every selectable configuration** | Pass, every one at exactly your price. **34,140 valid configurations quoted**, and **11,525 invalid rank ranges rejected** (target not above current). The test tries every field value, every enabled mode, and no extra / each extra / all extras together. Because all modifiers are $0 and add up, this covers every combination of extras. |
| Prices applied through the admin service | Pass. 11 price rows, 11 TEMPORARY audit rows, 0 ledger rows. |
| Quote API (14) | Pass: 200 with the USD total, or 403 for the 3 unpriced services. |
| Invalid configurations (11) | Pass. Unknown field, unknown option, client `price` / `totalAmount`, target ≤ current, 0 wins: all 400. |
| Order creation (11) | Pass. Wrong total or wrong currency: 409. Correct total: 201, `AWAITING_PAYMENT`, snapshot USD 4500/5500. |
| Stripe Checkout preparation (11) | Pass. `usd`, `unit_amount` = the server total. Order not in the booster pool. No ledger rows. |
| Live keys with compliance pending | Pass. Quote 403, order 403, and checkout of an order created in test mode 403, with no Stripe session created. |

Configurations quoted, per service:

| Service | Valid | Rejected | Totals |
|---|---|---|---|
| LoL rank-boost | 1,624 | 1,740 | $10 |
| LoL win-boost | 17,400 | 0 | $3–$300 |
| LoL placement-boost | 300 | 0 | $8 |
| LoL champion-mastery | 2,160 | 0 | $5 |
| VALORANT rank-boost | 600 | 650 | $10 |
| VALORANT win-boost | 100 | 0 | $3–$300 |
| VALORANT placement-boost | 130 | 0 | $8 |
| TFT rank-boost | 406 | 435 | $10 |
| TFT win-boost | 3,000 | 0 | $3–$300 |
| TFT placement-boost | 300 | 0 | $8 |
| TFT double-up-boost | 8,120 | 8,700 | $10 |

**Updated tests:** two tests asserted that "nothing is purchasable". They now assert the new rule: no real-money sale while compliance is pending, and test-key purchases only for published services that aren't rejected.
- [__tests__/catalog/catalog-integrity.test.ts](../__tests__/catalog/catalog-integrity.test.ts)
- [__tests__/orders/marketplace-safety.test.ts](../__tests__/orders/marketplace-safety.test.ts)

**Other checks:**
- **Full suite:** 665 passed, 20 failed. All 20 failures are in the 4 files that were already failing before this work: `security/rate-limit`, `security/sanitize`, `auth/password` (no suite), and `assignments.service` pauseAssignment.
- `tsc --noEmit` is clean. `next build` succeeds.
- I built once with a dummy `sk_test_` key to check the rendered pages. Service pages show "Review price" and the test-mode notice, and all 3 game badges say "Available". I then rebuilt normally.

## 8. Replacing the temporary prices later

1. Go to **Admin → Finance → Pricing** (`/dashboard/admin/finance/pricing`). Temporary prices carry an amber **"Temporary price: replace before launch"** badge. Services that can only be bought with test keys carry **"Compliance pending: Stripe test mode only"**.
2. Edit a service and save. This creates **version N+1** and retires the temporary version in one transaction. Existing orders keep their own snapshot and are never re-priced.
3. Check the currency field: the form defaults to EUR for a service that has no price yet.
4. Price every tier, every enabled mode and every enabled option. Anything left blank becomes unorderable; it is never free by accident.
5. The temporary badge disappears once the active version no longer carries the TEMPORARY note.
6. For real sales, the owner records the compliance decision. In [lib/catalog/game-services.ts](../lib/catalog/game-services.ts) and [lib/config/checkout-options.ts](../lib/config/checkout-options.ts), `complianceStatus` changes to `approved` per service. Then configure live Stripe keys and set `STRIPE_LIVE_MODE_ENABLED="true"` deliberately.

## 9. Files changed

| File | Change |
|---|---|
| `lib/catalog/game-services.ts`, `lib/config/checkout-options.ts` | All 14 published (`available`, `live-order`, `allowOrder: true`, label "Available"). `complianceStatus` unchanged. |
| `lib/stripe/mode.ts` (new) | Payment mode from the key prefix only |
| `lib/orders/order-eligibility.ts` | Separate publication and compliance gates. Test-mode waiver for `pending-review` only. `getPurchaseStatus`, `getGamePurchaseLabel`. |
| `lib/payments/checkout.service.ts` | Re-checks eligibility before creating a Stripe session |
| `lib/pricing/price-config.ts` | Optional `note` on the admin price input (stored in the audit row only). `TEMPORARY_PRICE_NOTE_PREFIX`. |
| `lib/pricing/temporary-prices.ts` (new), `scripts/apply-temporary-prices.ts` (new) | Temporary price definitions and the apply script (dry run by default) |
| `app/games/[gameSlug]/services/[serviceSlug]/page.tsx`, `components/checkout/CheckoutPanel.tsx` | Checkout button from the server's eligibility result. Test-mode notice. |
| `app/games/page.tsx`, `app/games/[gameSlug]/page.tsx`, `app/page.tsx`, `components/home/sections.tsx` | Computed game badges |
| `app/dashboard/admin/finance/pricing/page.tsx` | "Temporary price" and "test mode only" badges |
| Tests | One new file, two updated (see §7) |

**Note:** service and game pages are statically generated, so the badge reflects the Stripe key present **at build time**. Rebuild after changing keys. `npm run dev` renders on every request.
