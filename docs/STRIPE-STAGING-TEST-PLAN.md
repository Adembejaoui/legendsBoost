# Stripe Staging Test Plan

**Use Stripe TEST MODE only.** Never use production credentials, live keys or real cards. Nothing in this plan has been executed yet; payments are not claimed to work until it passes.

## 0. Preconditions (from earlier reports)

| # | Precondition | Reference |
|---|---|---|
| P1 | Blockers **B2** (edited migration checksum), **B3** (pending migrations incl. the baseline that must be *resolved*) and **B4** (uncommitted work) are resolved. | `docs/PHASE-1-COMPLETION-AND-STAGING-READINESS.md` §0, §5, §7 |
| P2 | `next build` passes in CI (B1 resolved). | `docs/TYPESCRIPT-BUILD-REMEDIATION.md` |
| P3 | A dedicated staging database and a Stripe account in **test mode**. | — |
| P4 | Business sign-off naming the single service to enable for the test (catalog flags) and its test price. | `docs/ORDER-CREATION-IMPLEMENTATION.md` §1 |

## 1. Migration

Follow the Phase 1 staging procedure (backup, URL check, `migrate status`, checksum review, baseline resolve, read-only legacy report). The pending set now ends with:

```text
20261113000000_order_payment_gate
20261114000000_payments_and_financial_ledger   (SHA-256 23f13718019d8e56…)
```

Review `20261114000000_payments_and_financial_ledger/migration.sql`. It is additive only: new enums and tables, three nullable `order` columns, six `NotificationType` values, CHECK constraints, append-only triggers, RLS on new tables, and the seeded 45/55 policy. Then:

```bash
npx prisma migrate deploy        # never migrate dev / reset
npx prisma migrate status        # up to date
psql "$STAGING_DIRECT_URL" -c "SET default_transaction_read_only = on;" \
  -c 'SELECT "platformFeeBps","boosterShareBps" FROM "commissionPolicy";' \
  -c "SELECT tgname FROM pg_trigger WHERE tgname LIKE '%append_only%' OR tgname LIKE '%no_truncate%';" \
  -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('payment','financialTransaction','boosterEarning','boosterPayout','paymentEvent');"
```

Expected: one policy 4500/5500; triggers `financialTransaction_append_only`, `financialTransaction_no_truncate`, `orderPricingSnapshot_append_only`, `financialAuditLog_append_only`; `relrowsecurity = t` on every listed table.

## 2. Stripe test-mode configuration

1. **Dashboard → Developers → API keys (test mode):** copy the `sk_test_…` secret key into the staging secret store. Do not paste it into chat, tickets or the repository.
2. **Dashboard → Developers → Webhooks → Add endpoint (test mode):**
   - URL: `https://<staging-host>/api/webhooks/stripe`
   - API version: **`2026-09-30.endive`** (the version pinned by `stripe@23.0.1`)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`
   - Copy the endpoint signing secret `whsec_…`.
3. **Staging environment variables** (deployment settings, not `.env` in git):

   | Variable | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_…` |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 2 |
   | `STRIPE_LIVE_MODE_ENABLED` | `false` (or unset) |
   | `APP_URL` | `https://<staging-host>` (https) |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional (`pk_test_…`); unused by hosted Checkout |
4. Optional local testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` gives a temporary `whsec_` for local use only.

## 3. Enable one service for the test (staging only)

1. On a **staging-only branch**, set the chosen service to live in `lib/catalog/game-services.ts` and `lib/config/checkout-options.ts`: `availability: "available"`, `orderCapability: "live-order"`, `complianceStatus: "approved"`, `allowOrder: true`. Do not merge this without business and compliance approval.
2. As an admin, open `/dashboard/admin/finance/pricing`, enter the agreed test price (all tiers, options and modes the test uses), and save. The service shows "Purchasable (price v1)".

## 4. Test cards and methods

Use Stripe's documented test values. Re-check them on the Stripe testing docs page before the run.

| Purpose | Value |
|---|---|
| Success | `4242 4242 4242 4242`, any future expiry, any CVC |
| Generic decline | `4000 0000 0000 0002` |
| Insufficient funds | `4000 0000 0000 9995` |
| 3-D Secure required | `4000 0025 0000 3155` |
| Dispute (fraudulent) | `4000 0000 0000 0259` |
| Delayed method | a test-mode delayed method enabled on the account (e.g. SEPA Debit with Stripe's test IBAN), if available |

## 5. Scenarios

Run each scenario and record the result, the order id and the PaymentEvent ids. Read-only verification SQL is in §6.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| S1 | Quote and creation | Customer configures the service → "Review price" → "Confirm" | Server total shown; order `AWAITING_PAYMENT`; snapshot 45/55; not in booster marketplace |
| S2 | Duplicate submission | Double-click Confirm, or replay the request with the same Idempotency-Key | One order |
| S3 | Price manipulation | Send `POST /api/orders` with an extra `price` field, or a wrong `expectedTotal` | 400 / 409; no order |
| S4 | Successful payment | Pay with 4242 | Redirect to success page → "Payment confirmed" within seconds; event `checkout.session.completed` PROCESSED; Payment SUCCEEDED; order `PENDING` with `paymentVerifiedAt`; ledger +total / +45% / +55%; earning RESERVED; customer notified; order listed for boosters |
| S5 | Stripe fee | After S4 | `payment.stripeFeeAmount` set; `STRIPE_FEES` entry; booster entries unchanged |
| S6 | Webhook replay | Dashboard → event → "Resend" | 200 duplicate; no new ledger rows |
| S7 | Declined card | Pay with 0002 / 9995 | Error on the Stripe page; `payment_intent.payment_failed` recorded on the attempt; order still `AWAITING_PAYMENT`; paying again with 4242 in the same session works |
| S8 | 3-D Secure | 3155, complete the challenge | As S4 |
| S9 | Abandon checkout | Click back / cancel on Stripe | `/checkout/cancelled`; "Try payment again" reuses the open session (same URL) |
| S10 | Session expiry | Wait for expiry (≥ 30 min) or expire the session via the Dashboard/API | `checkout.session.expired` → attempt EXPIRED; a new checkout creates attempt #2 |
| S11 | Repeated checkout | Open the payment page twice | The same Stripe URL is reused; one OPEN attempt |
| S12 | Customer cancel while open | Start checkout, then cancel the order in the workspace | Order CANCELLED; attempt CANCELED; session expired; paying afterwards (if raced) produces `ORDER_NOT_PAYABLE` review, not publication |
| S13 | Delayed method (if available) | Pay with the delayed method | `PROCESSING`, order not published, customer cannot cancel; then success publishes, or failure → attempt FAILED, retry possible |
| S14 | Invalid signature | `curl -X POST https://<staging-host>/api/webhooks/stripe -H 'stripe-signature: t=1,v1=bad' -d '{}'` | 400; no PaymentEvent row |
| S15 | Claim and complete | Booster claims the paid order and completes it | One assignment; earning PENDING for that booster; ledger pool −55% / payable +55% |
| S16 | Release and payout | Admin: Finance → Release → booster requests payout → admin Approve → Record payment (method, reference, evidence) | Payout PAID; earnings PAID; `BOOSTER_PAYABLE` 0 for the booster; audit rows; paying again with the same reference is refused |
| S17 | Multi-booster | New paid order: booster A claims and abandons; admin republishes; booster B completes | Earning PENDING_REVIEW; nothing payable; admin allocation summing to 55% creates two earnings |
| S18 | Partial refund | Admin: refund 30% from Finance | Refund SUCCEEDED (via response or webhook); ledger reversals 45/55 of the refund; order unchanged |
| S19 | Full refund before claim | New paid order, refund 100% | Order CANCELLED; ledger nets to 0 for the order; earning REVERSED |
| S20 | Dashboard refund | Refund a payment directly in the Stripe Dashboard | `refund.created` / `charge.refunded` → Refund row with `source = STRIPE`, admin alerted |
| S21 | Dispute | Pay with 0259 → dispute is created → in test mode submit losing/winning evidence | `charge.dispute.created` → Dispute OPEN, earnings ON_HOLD, release blocked; `closed` lost → loss posted once; won → earnings back to PENDING |
| S22 | Webhook failure and retry | Temporarily set a wrong `STRIPE_WEBHOOK_SECRET`, pay, restore the secret, then resend from the Dashboard (or retry the FAILED event from the Finance page) | First delivery 400; resend processes it once |
| S23 | Authorization | Booster or customer calls `/api/admin/finance/*`; customer A calls checkout for customer B's order; booster calls `/api/booster/earnings` | 403 / 404 / only own data |
| S24 | Existing features | Workspace chat, Riot panel, abandonment → DRAFT, admin republish of an **unpaid** draft (409), admin cancel of an unpaid draft | Unchanged behaviour |

## 6. Read-only verification queries

```sql
SET default_transaction_read_only = on;
-- Order, payment and snapshot
SELECT o.id, o.status, o."paymentVerifiedAt", o."paidPaymentId", s."totalAmount", s."platformFeeAmount", s."boosterShareAmount"
  FROM "order" o JOIN "orderPricingSnapshot" s ON s."orderId" = o.id WHERE o.id = '<order>';
SELECT id, "attemptNumber", status, amount, currency, "reviewReason", "failureCode", "stripeFeeAmount" FROM payment WHERE "orderId" = '<order>';
-- Ledger for the order (must net per account as documented)
SELECT type, account, amount, currency, "boosterId" FROM "financialTransaction" WHERE "orderId" = '<order>' ORDER BY "createdAt";
SELECT account, SUM(amount) FROM "financialTransaction" WHERE "orderId" = '<order>' GROUP BY account;
-- Webhook processing
SELECT "stripeEventId", type, status, attempts, outcome, "lastError" FROM "paymentEvent" ORDER BY "receivedAt" DESC LIMIT 20;
-- Side effects
SELECT type, status, attempts, "lastError" FROM "outboxEvent" ORDER BY "createdAt" DESC LIMIT 20;
-- Global invariant: no order is published without a verified payment
SELECT COUNT(*) FROM "order" WHERE status = 'PENDING' AND "paymentVerifiedAt" IS NULL AND "createdAt" > '<cut-over time>';
```

The last query must return 0. Legacy unpaid `PENDING` orders from before the cut-over are excluded by the date filter.

## 7. Sign-off

Record for the release ticket:

- every scenario's result, with order and event ids;
- the Stripe Dashboard event log export;
- the output of the queries in §6;
- confirmation that no live key was configured.

Only after a complete pass may anyone state that Stripe test-mode payments work end to end. Production requires its own live-mode configuration (`STRIPE_LIVE_MODE_ENABLED=true`, live webhook endpoint and secret), business approval of the catalog and prices, and a repeat of the critical scenarios (S4, S6, S7, S14, S16, S18) with real small amounts under finance supervision.
