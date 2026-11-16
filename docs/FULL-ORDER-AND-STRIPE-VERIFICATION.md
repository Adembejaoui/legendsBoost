# Full Order Creation and Stripe Payment Verification

Date: 2026-11-13

## Verdict

| Layer | Result |
|---|---|
| **A. Read-only checks** (real environment, real database, no writes) | Done. **A customer cannot complete a purchase in the real app today.** There are 4 blockers (§1). None of them is in the order or payment code. |
| **B. Automated tests** (isolated in-memory Postgres + fake Stripe client with real signature verification) | ✅ **All 14 services pass**, both the full purchase flow and the Stripe edge cases (28 / 28). Payment, catalog, order and assignment suites: 369 / 370 (the 1 failure is a stale test assertion, §6). |
| **C. Real Stripe test-mode integration** | ❌ **Not run.** No Stripe test key is configured (placeholders only), and it would write permanent records to a database that may be production. Authorization and setup are needed (§5). |

**The real end-to-end flow has NOT been proven.** Only B, with mocks, has passed. No database records were written and no Stripe calls were made.

---

## 1. Blockers found

| # | Blocker | Evidence | Effect in the real app | Fix owner |
|---|---|---|---|---|
| B1 | **Stripe not configured.** `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local` are the placeholders `sk_test_YOUR_KEY` / `pk_test_YOUR_KEY` (16 chars; real keys are about 100). `STRIPE_WEBHOOK_SECRET` is missing. | Read-only env inspection (values not printed). `isPlaceholder()` in `lib/stripe/server.ts` treats these as unset. | `POST /api/orders/[id]/checkout` → 503 *"Online payment is not available right now."* The webhook can't verify any event. | Owner: add a real **test-mode** key |
| B2 | **`APP_URL` not set** (neither is `NEXTAUTH_URL`). | Env inspection | `getAppUrl()` throws, and Checkout can't build success/cancel URLs (503). | Owner: `APP_URL=http://localhost:3000` |
| B3 | **Catalog not approved.** All 14 services are `pending-review` / `draft-only` / `allowOrder: false`. | Source, and the build output: all 14 service pages render a disabled **"Under review"** button. | Quote and order creation → 403 *"This service is not available for purchase yet."* | Owner decision (see `docs/FULL-CATALOG-SELLABILITY-AUDIT.md` §5) |
| B4 | **No prices.** The `servicePrice` table has 0 rows. | Read-only SQL | Quote → 403 even after B3 | Admin, or test prices in an isolated database (§3) |
| — | `STRIPE_TEST_MODE`, `STRIPE_TEST_AMOUNT_CENTS=100`, `STRIPE_TEST_CURRENCY=usd` in `.env.local` | `grep` across `app/ lib/ components/`: **no code reads them** | None. Leftovers. They are *not* a fallback price, and they should be removed so nobody assumes they do something. | Owner |

No defect was found in quote, order creation, checkout, webhook, payment verification, marketplace or claim code. The fixes from the earlier audit (duplicate `champions-roles`, VALORANT division order, checkout button, PER_UNIT message) are still in place.

---

## 2. A. Read-only checks (real environment)

### Database identity
| Item | Value |
|---|---|
| Host | `aws-0-eu-west-1.pooler.supabase.com:6543` (Supabase pooler; `DIRECT_URL` is the same host) |
| Database | `postgres`, PostgreSQL 17.11 |
| Supabase project | `cscdwipzjfxffvokhomb` (from `NEXT_PUBLIC_SUPABASE_URL`) |
| Production or development? | **Cannot be confirmed, so it is treated as production.** The Supabase and Vercel connectors were unavailable (overloaded / timeout). The repository has a deployment commit (`fix: generate Prisma client during deployment`). The data contains 8 `gmail.com` accounts that may belong to real people. No environment marker (`NODE_ENV`, `VERCEL_ENV`) identifies it. |
| Migrations | All applied, the latest being `20261114000000_payments_and_financial_ledger`. None rolled back. |

### Contents (counts only; no personal data read)
| Table | State |
|---|---|
| user | 4 CUSTOMER, 3 ADMIN, 2 BOOSTER (1 approved booster profile) |
| order | 10 legacy orders from before the payment gate (9 LoL rank-boost, 1 LoL win-boost): 5 PENDING, 3 IN_PROGRESS, 1 COMPLETED, 1 DRAFT, **all with `paymentVerifiedAt = NULL`**. 0 AWAITING_PAYMENT. |
| payment / paymentEvent / financialTransaction / orderPricingSnapshot | 0 rows each |
| servicePrice | 0 rows |
| commissionPolicy | 1: `commission_policy_initial_45_55`, 4500 / 5500 bps |

### Safety checks against the real data
- **Unpaid orders claimable: 0.** The marketplace query requires `paymentVerifiedAt IS NOT NULL` (`lib/orders/payment-gate.ts`), so the 5 legacy unpaid `PENDING` orders are excluded.
- 4 legacy orders (IN_PROGRESS / COMPLETED) were worked on without payment before the gate existed. This is historical and was not changed. See `scripts/` (`report-legacy-orders`).

### Stripe API authentication
**Not possible.** There is no real key to authenticate with. Live keys would also be refused unless `STRIPE_LIVE_MODE_ENABLED="true"` (it is unset), which is correct.

### Code inspection (confirmed in the current source)
| Area | Finding |
|---|---|
| Customer catalog | `next build` compiles and renders all 14 `/games/<game>/services/<service>` pages. |
| Quote / order creation | Strict request schema. Eligibility → validation → ACTIVE price → commission policy → integer engine. `expectedTotal` must match (409). Idempotency-Key required; replay returns 200 with the same order. Orders are created `AWAITING_PAYMENT` with an immutable 45/55 snapshot. |
| Checkout | Amount and currency come only from the snapshot. Stripe idempotency key `checkout:<orderId>:<attempt>`. An open session is reused. The returned session's amount and currency are re-checked. The URL comes from `APP_URL`, never from request headers. |
| Success / cancel pages | Read-only: they poll `GET /api/orders/[id]/payment`. **Only the webhook marks an order paid.** |
| Webhook | Signature verified on the raw body. Duplicate events are stored once. It handles completed (paid / unpaid), async succeeded / failed, expired, payment_failed, refunds and disputes. Amount, currency, metadata, customer, snapshot and duplicate-payment mismatches are flagged for review and never publish the order. |
| Marketplace / claim | Pool and claim require a verified payment. Claim needs an APPROVED booster, and the active-assignment uniqueness makes it atomic. |
| Ledger | `financialTransaction`, `orderPricingSnapshot` and `financialAuditLog` are **append-only, enforced by database triggers**. |

---

## 3. Test pricing approach

| Option | Assessment |
|---|---|
| **Isolated fixtures in automated tests** (`__tests__/support/catalog-fixtures.ts`) | **Used.** Fixture amounts are created through the real admin service, only inside the in-memory test database. They can't reach production because they exist only in test code. |
| A "test pricing provider" switch in app code | **Not implemented.** It would add a code path that serves prices not set by an admin, and it would still need the catalog approval override. That is exactly the bypass the requirements forbid. It also wouldn't solve the real problem, which is where the test orders get written. |
| Test price versions in a **separate development database** through the normal admin UI | **Recommended for C.** No code change, server validation fully exercised, and no risk to commercial prices. |
| Test price versions in the current database | Possible but discouraged. Each version writes a permanent `financialAuditLog` row. An ACTIVE test price would go live the moment B3 is resolved, unless it is retired first. |

---

## 4. B. Automated test results (isolated, mocked Stripe)

Environment: PGlite in-memory Postgres built from the real migrations (constraints, triggers and ledger immutability are real). The fake Stripe client uses the **real Stripe SDK webhook signature code**. Real catalog. Sellability flags are overridden to "approved" **in the test only**. Fixture prices. No network.

File: [__tests__/payments/catalog-purchase-e2e.test.ts](../__tests__/payments/catalog-purchase-e2e.test.ts), two tests per service.

**Test 1, full flow:**
1. Unpriced → 403.
2. Admin price version.
3. Quote 200 for every mode × all of its options, with the exact expected total and no commission exposed.
4. Invalid inputs → 400: unknown field or option, browser price, bad mode, target ≤ current, quantity 0. No order is created.
5. Manipulated total → 409. Correct total → 201, `AWAITING_PAYMENT`, 45/55 snapshot.
6. Unpaid → not in pool, claim rejected.
7. Checkout session for exactly the snapshot amount in EUR.
8. Bad signature → 400 and still unpaid. Valid signature → `payment_succeeded`.
9. Verified → `PENDING` and in pool.
10. Booster claim succeeds with one active assignment.
11. Ledger: payment = total = 45% + 55%, matching the snapshot.

**Test 2, Stripe edge cases:**
- Order replay with the same Idempotency-Key returns the same order.
- Checkout reuses the open session with no second Stripe call.
- Duplicate webhook → `duplicate: true`, each ledger line posted once.
- Amount mismatch and currency mismatch → flagged, not published, no booster earning.
- Delayed payment: completed + unpaid → `awaiting_async_payment` (not claimable) → async succeeded → published.
- Failed payment: async failed → `payment_failed`, order still `AWAITING_PAYMENT` → attempt 2 → paid.
- Cancelled / abandoned: session expired → `session_expired`, not published, a new checkout can be started.

| Service | Flow | Edge cases |
|---|---|---|
| league-of-legends:rank-boost | ✅ | ✅ |
| league-of-legends:win-boost | ✅ | ✅ |
| league-of-legends:placement-boost | ✅ | ✅ |
| league-of-legends:arena-boost | ✅ | ✅ |
| league-of-legends:normal-matches | ✅ | ✅ |
| league-of-legends:champion-mastery | ✅ | ✅ |
| valorant:rank-boost | ✅ | ✅ |
| valorant:win-boost | ✅ | ✅ |
| valorant:placement-boost | ✅ | ✅ |
| valorant:unrated-matches | ✅ | ✅ |
| teamfight-tactics:rank-boost | ✅ | ✅ |
| teamfight-tactics:win-boost | ✅ | ✅ |
| teamfight-tactics:placement-boost | ✅ | ✅ |
| teamfight-tactics:double-up-boost | ✅ | ✅ |

**28 / 28 passed.** The existing single-service suites also pass, `payment-flow.test.ts` among them: checkout ownership (404 / 403 for others), Stripe outage → 502 + retry, Stripe not configured → 503, metadata mismatch, second payment on a paid order, unknown session, live-mode event ignored, DB failure rollback + retry, notification failure not undoing payment, Stripe fee as platform cost, concurrent claims (exactly one wins). The same applies to `finance-flow`, `order-creation`, `migration` and `marketplace-safety`, plus the 94 catalog-integrity tests.

### Results by area (B only)
| Area | Result |
|---|---|
| Order creation | ✅ 14 / 14: 201, `AWAITING_PAYMENT`, idempotent replay, 409 on a tampered total |
| Checkout | ✅ 14 / 14: exact amount and currency, session reuse, retry after failure or expiry |
| Webhook | ✅ 14 / 14: signature enforced, duplicates ignored, mismatches flagged, async success and failure handled |
| Booster claim | ✅ 14 / 14: unpaid never listed or claimable, paid claimable once |
| Ledger | ✅ 14 / 14: 45 / 55 exactly, each line posted once, matches the immutable snapshot |

Whole suite (`npx vitest run`): 611 passed, 20 failed, in 4 files that already failed before this work (§6). `next build`: ✅ compiles, 63 pages.

---

## 5. C. Real Stripe test mode: what's needed, and the records it would create

**Not performed.** It needs your authorization and setup.

### Prerequisites
1. A Stripe **test-mode** secret key (`sk_test_…`) and publishable key in `.env.local`. Never `sk_live_`.
2. Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, then put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
3. `APP_URL=http://localhost:3000`.
4. Catalog approval (B3), either the owner commit or a local, uncommitted edit used only for the test.
5. **Strongly recommended: a separate development database.** For example a Supabase branch or a new project, or a local Postgres with `prisma migrate deploy` run against *that* database only. Then point `DATABASE_URL` / `DIRECT_URL` at it in `.env.local`.

### Records a full 14-service run would create (in whichever database `DATABASE_URL` points to)

| Table | Rows | Removable afterwards? |
|---|---|---|
| user (+ customerProfile, account/session on login) | 2–3 new test users (customer, booster, optionally admin). Existing users untouched. | yes |
| boosterProfile | 1 (test booster, APPROVED) | yes |
| servicePrice | 14 test versions (ACTIVE; retire afterwards) | retire only. The versions stay as history. |
| **financialAuditLog** | ~14 (price created) + ~14 (retired) | **no, append-only trigger** |
| order | 14 (one paid order per service, the minimum) | only if dependents can go too |
| **orderPricingSnapshot** | 14 | **no, append-only trigger** |
| payment | ≥ 14 | yes |
| paymentEvent | ≥ 14–28 (completed + Stripe's other events) | yes |
| **financialTransaction** (ledger) | 42 (3 per order) + up to 14 STRIPE_FEE | **no, append-only + no-truncate triggers** |
| boosterEarning | 14 (RESERVED) | yes |
| orderBoosterAssignment | up to 14 (claims) | yes |
| orderEvent, notification, outboxEvent | several per order | yes |

**In the current database (possibly production), the ledger, snapshot and audit rows from a test run would be permanent.** They would show up in finance totals and reports for good. This is why a separate database is recommended.

### Question for you
Choose one:
- **(Recommended)** Set up a separate development database and real Stripe **test** keys, then authorize running C there.
- Authorize C on the current database, accepting the permanent test rows above.
- Leave C for later.

---

## 6. Remaining issues

| # | Issue | Severity |
|---|---|---|
| R1 | B1–B4 above. They block every real purchase. | Blocker |
| R2 | Unused `STRIPE_TEST_*` variables in `.env.local` | Low; remove them |
| R3 | 4 test files already failing: `security/rate-limit.test.ts` (`clearRateLimit is not a function`, API drift), `security/sanitize.test.ts`, `auth/password.test.ts` (no test suite in the file; a `.js` twin exists), `assignments.service.test.ts` › pauseAssignment (stale assertion: the function now returns `{ assignment, order }`). None of them touches ordering or payments. | Low; test maintenance |
| R4 | 4 legacy orders worked without payment, from before the gate (historical) | Info, not changed |
| R5 | Business decisions D1–D6 in `docs/FULL-CATALOG-SELLABILITY-AUDIT.md` §7 (disabled options, coaching-style option sets, rank-dependent win pricing, mastery pricing basis, apex tiers, legacy coaching entries) | Business |

## 7. Files changed in this verification

| File | Change |
|---|---|
| [__tests__/payments/catalog-purchase-e2e.test.ts](../__tests__/payments/catalog-purchase-e2e.test.ts) | Added the per-service Stripe edge-case test (idempotency, duplicates, amount/currency mismatch, delayed, failed, expired). |
| `docs/FULL-ORDER-AND-STRIPE-VERIFICATION.md` | This report |

No application code, configuration, prices, catalog flags, migrations or database records were changed. No Stripe calls were made.

---

## 8. Manual test instructions (layer C, once §5 is authorized)

1. **Configure** `.env.local`: test keys, `STRIPE_WEBHOOK_SECRET` from `stripe listen`, `APP_URL=http://localhost:3000`, and `DATABASE_URL` / `DIRECT_URL` pointing at the **dev** database.
2. Check the mode: `node --env-file=.env --env-file=.env.local -e "console.log(process.env.STRIPE_SECRET_KEY.slice(0,8))"` must print `sk_test_`.
3. Start `npm run dev` and, in a second terminal, `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
4. **Approve the catalog** for the test (§1 B3).
5. **Admin** → `/dashboard/admin/finance/pricing`: enter clearly fake test prices for all 14 cards, for example `1.00` base and `0.50` per step, unit, mode and option. Each card must show "Purchasable (price v1)". Commission must show 45 / 55.
6. **Customer** (new test account) → for each of the 14 services: configure → **Review price** (total appears) → try an invalid setup such as target ≤ current (rejected) → **Confirm order and continue to payment** → **Continue to Payment** → on Stripe Checkout use `4242 4242 4242 4242`, any future date, any CVC.
   - 3D Secure: `4000 0027 6000 3184` (complete the challenge).
   - Decline: `4000 0000 0000 0002`.
   - Delayed (async) payment needs a delayed payment method such as SEPA Debit to be enabled on the session. If Checkout is card-only, delayed handling is covered only by layer B. To simulate it, use `stripe trigger checkout.session.async_payment_succeeded`. Note that triggered events carry Stripe's own fixture metadata and are expected to come back as `unknown_session`.
   - Cancel: click back on Checkout → `/checkout/cancelled`, and the order stays payable.
7. After each payment: the success page shows paid. `stripe listen` shows `checkout.session.completed` → 200. In the DB, `order.paymentVerifiedAt` is set and status is `PENDING`.
8. **Booster** (approved test booster) → Available orders: the paid order is listed and unpaid ones are not. Claim it, and a second booster's claim of the same order fails.
9. **Ledger**: Admin → Finance → Transactions. For each order: CUSTOMER_PAYMENT = total, PLATFORM_COMMISSION = 45%, BOOSTER_SHARE_RESERVED = 55%.
10. Duplicate check: `stripe events resend <evt_id>` → 200 `duplicate: true`, with no new ledger rows.
11. **Clean up**: retire every test price in the admin UI. Revert any local-only catalog approval edit. Remove the test keys if the machine is shared.
