# Phase 1: Order Marketplace Safety Report

**Date:** 2026-11-12
**Scope:** Phase 1 of `docs/ORDER-PAYMENT-FINANCIAL-AUDIT.md`: immediate marketplace safety. No Stripe, no financial models, commission policy untouched.
**Status:** Implemented and unit-tested locally. **Not verified in staging. Not production-ready** until the staging checklist in §9 passes.

Nothing was executed against any database: no migration was applied, no `prisma migrate dev`/`reset`/`deploy` was run, and the legacy report script was **not** run. `prisma generate` (local client codegen into the git-ignored `app/generated/prisma/`) and `prisma validate` were run.

---

## 1. Outcome in one paragraph

An order can now reach boosters only if it is `PENDING` **and** has a server-verified payment (`order.paymentVerifiedAt IS NOT NULL`). Nothing sets that marker in Phase 1, and there is deliberately no manual "mark as paid" shortcut. So no order, new or legacy, is listed or claimable until real payment verification exists. New orders are created as `AWAITING_PAYMENT` (never `PENDING`), and only after a deny-by-default server-side catalog check, which every current catalog item fails (`draft-only` / `allowOrder: false`). Admin republish of a DRAFT now requires a verified payment. Boosters can no longer cancel a customer's order (route and service both refuse). Abandonment → DRAFT is unchanged.

---

## 2. Audit: every path that can make an order visible to, or workable by, boosters

| # | Path | Before | After |
|---|---|---|---|
| 1 | `POST /api/orders` (`app/api/orders/route.ts`) | created **PENDING** (marketplace) with no payment; ignored `draft-only` / `allowOrder:false` | catalog gate (403/400), creates **AWAITING_PAYMENT**, `paymentVerifiedAt` NULL |
| 2 | `getAvailableOrders` (`lib/assignments/service.ts`), used by `GET /api/booster/orders/available`, `app/dashboard/booster/available-orders/page.tsx`, `app/dashboard/booster/page.tsx` | `status = PENDING` and no active assignment | query adds `paymentVerifiedAt IS NOT NULL`; `isOrderClaimable` re-checks it in memory |
| 3 | `claimOrder` (`POST /api/booster/orders/:id/claim`) | conditional `where { id, status: PENDING }` | pre-check plus conditional `where { id, status: PENDING, paymentVerifiedAt: { not: null } }` in the **same** statement; unique `activeOrderId` race protection unchanged |
| 4 | `republishDraftOrder` (`POST /api/admin/orders/:id/republish`) | `DRAFT → PENDING` for any draft | 409 without verified payment; conditional `where` includes the gate |
| 5 | `acceptAssignment` (legacy `POST …/accept`) | `PENDING → IN_PROGRESS` conditional on status | gate added to the conditional `where` |
| 6 | `releaseAssignment` as ADMIN (`POST …/release`) | `IN_PROGRESS/PAUSED → PENDING` | **unchanged**. The order becomes PENDING but stays invisible/unclaimable unless paid (paths 2–3). See risk R4. |
| 7 | `reassignOrder` (`lib/assignments/service.ts`) | admin assigns directly; **no API route calls it** | unchanged (unreachable); risk R5 |
| 8 | `startAssignment` (legacy `POST …/start`) | unconditional `→ IN_PROGRESS`; needs a pre-existing `ACCEPTED` assignment | unchanged; risk R5 |
| 9 | `POST /api/orders/draft` | in-memory only, never written to the DB, never visible to boosters | unchanged (not a visibility path) |
| 10 | Payment page `app/checkout/payment` / `components/payment/*` | non-functional; cannot confirm payment | unchanged; it cannot set `paymentVerifiedAt` |
| 11 | Customer order UI `components/checkout/CheckoutPanel.tsx` | posts to `POST /api/orders` | unchanged; now receives the server's 403 message ("This service is not available for purchase yet.") |

No raw SQL writes to `order` exist in application code.

---

## 3. Code changes

| File | Change |
|---|---|
| `prisma/schema.prisma` | `OrderStatus.AWAITING_PAYMENT`; `Order.paymentVerifiedAt DateTime?` (documented as written only by future payment verification) |
| `prisma/migrations/20261113000000_order_payment_gate/migration.sql` *(new, not applied)* | `ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT'`; `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "paymentVerifiedAt" TIMESTAMP(3)`. Generated offline with `prisma migrate diff --from-schema … --to-schema …`. |
| `lib/orders/payment-gate.ts` *(new)* | `VERIFIED_PAYMENT_WHERE`, `hasVerifiedPayment()`, message constant |
| `lib/orders/order-eligibility.ts` *(new)* | `evaluateOrderEligibility()` (pure) / `getOrderEligibility()`: deny by default, requires offer and checkout to be `available`, `live-order`, `approved` (when set), and checkout `allowOrder === true` |
| `app/api/orders/route.ts` | uses the eligibility gate; creates `AWAITING_PAYMENT` |
| `lib/assignments/service.ts` | gate in `isOrderClaimable`, `getAvailableOrders`, `claimOrder` (pre-check + conditional update), `acceptAssignment`; `cancelAssignment` throws for any non-ADMIN; P2025 message now "order is no longer available" |
| `lib/assignments/types.ts` | `AWAITING_PAYMENT: ["PENDING","CANCELLED"]` in the transition table; `BoosterCancellationForbiddenError` |
| `app/api/booster/orders/[orderId]/cancel/route.ts` | ADMIN only: BOOSTER gets 403 with the "abandon instead" message; others 403 |
| `lib/orders/draft-admin.service.ts` | republish requires verified payment (409) and gates the conditional update |
| `app/dashboard/admin/orders/[orderId]/page.tsx`, `DraftEditor.tsx` | republish button replaced by an explanation when the draft has no verified payment (server still enforces) |
| `lib/orders/status-display.ts`, `lib/orders/statuses.ts` | display config "Awaiting payment"; included in customer "Active" lists |
| `scripts/report-legacy-orders.mjs` *(new)* | read-only legacy reconciliation report (§6) |

Unchanged on purpose: the Stripe UI shell, `Order.price`, commission (none exists), the abandonment workflow, chat/Riot modules, all previously applied migration files.

### Why a schema change was unavoidable

The rule "no order is treated as paid merely because it is PENDING" needs a durable, per-order record of verified payment that the marketplace query and the claim's conditional `UPDATE` can test in one statement. No existing column can express that. `price` is mutable by admins and says nothing about payment. Reusing `DRAFT` for unpaid orders would mix them into the abandoned-order admin queue, where admins can republish. So the change is the minimum that works: one nullable timestamp (not a financial model: no amounts, no currency, no provider data) and one additive enum value.

The DB default stays `'PENDING'`. Changing it would *use* the new enum value in the same migration (PostgreSQL 55P04). This is safe: any row created through another path is still blocked by the NULL `paymentVerifiedAt`.

---

## 4. Booster cancellation

- `POST /api/booster/orders/:orderId/cancel` returns **403** to boosters before any DB access: *"Boosters cannot cancel customer orders. Abandon the order instead; it will be returned for admin review."*
- `cancelAssignment()` throws `BoosterCancellationForbiddenError` for any non-admin role, so a future route can't reintroduce the hole by forgetting the check.
- Admin cancel still works (and still revokes the booster's realtime access).
- The booster UI never called `/cancel` (only pause, resume, complete and abandon), so no UI change was needed.
- Abandonment is unchanged. The assignment ends as `RELEASED` with `endReason "ABANDONED: <reason>"`, `endedAt` set, `activeOrderId` cleared, a `BOOSTER_ABANDONED` event with `{ assignmentId, boosterId, reason, previousStatus }`, and the order moves to `DRAFT`. A booster calling `/release` is still routed to abandonment. Assignment rows are never deleted.

---

## 5. Existing data: what changes and what does not

- **No row is modified** by the migration or the code. Statuses are not converted, and old assignment records are untouched.
- Every existing order gets `paymentVerifiedAt = NULL`, which means **not paid**. Nothing is assumed to be paid.
- **Behavioural consequences** (intended, but stakeholders must know before deploy):
  1. Legacy `PENDING` orders **disappear from the booster marketplace** and cannot be claimed.
  2. **No DRAFT can be republished** until payments exist.
  3. Legacy `IN_PROGRESS` / `PAUSED` orders keep working: the assigned booster can pause, resume, complete or abandon. Phase 1 blocks *new* booster access to unpaid orders. It doesn't stop work already in progress (see R2).
  4. `COMPLETED`, `CANCELLED` and in-progress orders remain readable by customers, boosters and admins (tested).

---

## 6. Legacy order reconciliation report

`scripts/report-legacy-orders.mjs` lists all orders without a verified payment, grouped by status with a recommended action. It also flags any order that already has `paymentVerifiedAt` set, which would be an anomaly because nothing sets it in Phase 1.

- Runs in a `BEGIN READ ONLY` transaction that is rolled back.
- Works before **and** after the migration (it detects whether the column exists).
- **Never reads `DATABASE_URL` from `.env`.** It requires `LEGACY_REPORT_DATABASE_URL` explicitly, so it can't hit production by accident.
- Prints ids/statuses/timestamps only (no names, e-mails or credentials).

```bash
LEGACY_REPORT_DATABASE_URL="<staging connection string>" node scripts/report-legacy-orders.mjs
LEGACY_REPORT_DATABASE_URL="<staging connection string>" node scripts/report-legacy-orders.mjs --json > legacy-orders.json
```

**It has not been run.** I did not connect to any database. The only prior evidence (`docs/PRISMA-MIGRATION-FINAL-DECISION.md`, one inspected dev database, 2026-11-10) recorded COMPLETED=1, IN_PROGRESS=2, PENDING=5. Treat those numbers as stale until the script is run on staging. Expected reconciliation work:

| Status | Decision needed (business/ops) |
|---|---|
| IN_PROGRESS / PAUSED | Was the customer charged out-of-band? If not: let finish, or admin-cancel. |
| PENDING | Contact the customer, cancel, or hold until Stripe exists. |
| DRAFT | Hold or admin-cancel (admin cancel of DRAFT is still not implemented; see R6). |
| COMPLETED | Mark for exclusion from future booster earnings, or reconcile manually. |

---

## 7. Tests and results

### New: `__tests__/orders/marketplace-safety.test.ts`: 35 tests, all passing

It runs the real services and route handlers against an in-memory Prisma fake that reproduces conditional-update `P2025` and unique-`activeOrderId` `P2002` behaviour.

| Required case | Test(s) |
|---|---|
| New unpaid order cannot appear in marketplace | created via `POST /api/orders` → not listed, claim rejected, still `AWAITING_PAYMENT`; marketplace `where` contains `paymentVerifiedAt: { not: null }`; defence-in-depth filter; legacy unpaid PENDING hidden and **not converted** |
| Catalog `allowOrder: false` blocks creation | route 403, no `order.create`; eligibility rule table; real catalog contains `allowOrder:false` entries and none is purchasable |
| `draft-only` services cannot be purchased | route 403 with message; offer-level and checkout-level `draft-only` / `request-only` / pending-review / rejected all denied |
| Booster cannot cancel a customer's order | route 403 with no state change; service refuses `BOOSTER`; customer 403; admin still 200 |
| Booster can still abandon | abandon route → `DRAFT`, assignment `RELEASED` with reason, history row kept, event metadata; abandoned order stays out of marketplace |
| Admin cannot publish an unpaid order | service 409 with no update; route 409 with message; positive control: paid draft republishes and becomes listed |
| Two boosters cannot claim the same order | concurrent claims on a paid order → exactly one assignment, loser gets `OrderAlreadyClaimedError`; conditional update includes PENDING and the payment gate |
| Existing completed and in-progress orders remain readable | `GET /api/orders/:id` 200 for legacy COMPLETED and IN_PROGRESS; workspace access unchanged |

### Existing tests updated (behaviour change, not weakening)

- `__tests__/assignments.service.test.ts`: claim fixtures now carry a verified payment (and the `assignedAt`/`startedAt` the service needs); expected conditional `where` includes the gate; `getAvailableOrders` asserts an unpaid PENDING row is excluded; booster-cancel test is now admin-cancel; added notification/realtime mocks (the Prisma mock had no `notification` table, which made the **concurrent-claim test fail before this change**; it passes now).
- `__tests__/assignments/reassignment-revocation.test.ts`: cancel revocation test performed by an admin.
- `__tests__/orders/lifecycle.test.ts`: `isOrderClaimable` requires payment.
- `__tests__/orders/draft-admin.test.ts`: successful republish uses a paid draft; invalid-config test uses a paid draft so it still tests validation.

### Suite results (`npx vitest run`)

| | Test files | Tests |
|---|---|---|
| Baseline (before changes) | 4 failed / 22 passed (26) | **22 failed / 296 passed** (318) |
| After | 4 failed / 23 passed (27) | **20 failed / 333 passed** (353) |

The remaining 20 failures are **pre-existing and unrelated** (same files failed at baseline): `security/rate-limit.test.ts` (10), `security/sanitize.test.ts` (9), `assignments.service.test.ts › pauseAssignment` (1, stale return-shape assertion), and `auth/password.test.ts` (suite fails to load). They were left alone as out of scope.

**Test runner note:** Vitest fails every file ("failed to find the runner") when started from a lower-case drive path (`c:\…`, which is how the VS Code terminal opens). Run it from `C:\Users\tun\Desktop\legendsboost` (upper-case `C:`). This explains the "no tests executed" results in earlier docs. No config change was made.

### Other checks

| Check | Result |
|---|---|
| `npx prisma validate` | valid |
| `npx prisma generate` | generated (local, git-ignored) |
| `npx tsc --noEmit` | 40 errors, **identical count to baseline**, none in files changed by Phase 1 (pre-existing: `CustomerOrderFilter.tsx`, `review-client.tsx`, `PaymentPageClient.tsx`, `lib/support/service.ts`, `package/dist/…`, test mocks) |
| `npx eslint` on new files | clean |
| `npx eslint` on modified files | 9 errors / 4 warnings, all on pre-existing lines (`any` casts, unused imports, `prefer-const` on the original `where`) |
| `npx eslint .` | 80,618 problems, dominated by the vendored `package/` directory; pre-existing |
| `next build` | **not run** (needs full env; run in staging) |

---

## 8. Remaining risks

| ID | Risk | Severity | Mitigation / next phase |
|---|---|---|---|
| R1 | **Deploy ordering.** Prisma selects every scalar column, so once the new client is deployed, *every* order query fails until the `paymentVerifiedAt` column exists. | **High (operational)** | Apply the migration **before** deploying the code (additive and safe for the old code). See §9. |
| R2 | Legacy unpaid IN_PROGRESS/PAUSED orders can still be completed by their booster. | Medium | Reconcile using the report; earnings design (Phase 6) must exclude unverified orders. |
| R3 | Any role (including BOOSTER/ADMIN accounts) may create orders once a service becomes purchasable. Not reachable today (no service is purchasable). | Medium | Restrict creation to CUSTOMER before enabling any live-order service. |
| R4 | Admin release still sets an unpaid order to `PENDING`. It stays hidden and unclaimable, but its status label says "Pending". | Low | Revisit with the Phase 5 cancellation/refund flow. |
| R5 | `startAssignment` (legacy) and `reassignOrder` (unrouted) still write order status unconditionally. | Low | Make conditional or delete in a later phase. |
| R6 | No admin cancel for DRAFT and no customer cancel. Unpaid legacy drafts can't be closed through the app. | Medium | Phase 5. |
| R7 | `paymentVerifiedAt` is only as trustworthy as its writers. A manual SQL `UPDATE` would open the gate. | Medium | Restrict DB write access; the report flags any non-NULL value; Phase 4 must make the verified webhook the only writer and add an audit event. |
| R8 | No idempotency/rate limit on `POST /api/orders` (duplicate orders). Moot while nothing is purchasable. | Medium | Phase 3/4. |
| R9 | Supabase RLS coverage on `public` tables is still unverified (audit S11). The new column inherits the `order` table's exposure. | **High until verified** | Verify before any payment work. |
| R10 | Edited, already-applied migration `20261102210000_simplify_order_statuses` (audit §15.1). `prisma migrate dev` may offer a destructive reset. | High (process) | Use `prisma migrate deploy` only; resolve the checksum question per environment first. |
| R11 | The Stripe payment page remains a non-functional shell. Customers reaching it see "Order not found". | Low | Phase 4 replaces it. |
| R12 | Customer-facing `PENDING` description still says "available to be claimed by a booster", which is now inaccurate for unpaid legacy orders. | Low | Copy change once the reconciliation decisions are made. |

---

## 9. Staging verification (required before any production deploy)

Do this on **staging only**, with a staging database and staging credentials.

**A. Pre-checks**
1. Confirm the target is staging: `node -e "console.log(new URL(process.env.DIRECT_URL).host)"` with the staging env loaded.
2. Take a database backup/snapshot (Supabase → Database → Backups), or record the PITR timestamp.
3. `npx prisma migrate status`. **Superseded:** the assumption that only `20261113000000_order_payment_gate` is pending is wrong for an environment that matches the database inspected on 2026-11-10, where six migrations are pending, one of which (the baseline) must be *resolved*, not run. Follow §5–§7 of `docs/PHASE-1-COMPLETION-AND-STAGING-READINESS.md` instead. **If it reports a modified or failed migration, or offers a reset, stop** (risk R10).
4. Run the legacy report **before** the migration and save the output:
   `LEGACY_REPORT_DATABASE_URL="$STAGING_DIRECT_URL" node scripts/report-legacy-orders.mjs --json > legacy-before.json`
   (`gateColumnPresent` should be `false`.)

**B. Apply the schema (before deploying code)**
5. `npx prisma migrate deploy` (never `migrate dev` / `migrate reset`).
6. Verify in SQL:
   ```sql
   SELECT enum_range(NULL::"OrderStatus");                         -- includes AWAITING_PAYMENT
   SELECT column_name, is_nullable, data_type FROM information_schema.columns
    WHERE table_name = 'order' AND column_name = 'paymentVerifiedAt'; -- YES, timestamp without time zone
   SELECT COUNT(*) FROM "order" WHERE "paymentVerifiedAt" IS NOT NULL;  -- 0
   SELECT status, COUNT(*) FROM "order" GROUP BY status;               -- identical to legacy-before.json summary
   ```
7. Run the report again (`legacy-after.json`). Counts per status must equal `legacy-before.json`, `gateColumnPresent: true`, and no anomalies.

**C. Deploy the code to staging**, then verify by hand with real sessions:
8. **Customer:** try to order any catalog service → error "This service is not available for purchase yet."; no new row in `order`.
9. **Booster (approved):** `/dashboard/booster/available-orders` shows no legacy PENDING orders; `POST /api/booster/orders/<legacyPendingId>/claim` with `{}` → 400 "…payment has not been verified"; no new `orderBoosterAssignment` row.
10. **Booster on an existing IN_PROGRESS order:** `POST /api/booster/orders/<id>/cancel` with `{"assignmentId":"<id>"}` → 403; order still `IN_PROGRESS`. Pause, resume and abandon (with a reason) still work; abandon → order `DRAFT`, assignment `RELEASED` with `ABANDONED: <reason>`.
11. **Admin:** open the abandoned draft at `/dashboard/admin/orders/<id>`. The republish button is replaced by the "no verified payment" notice. `POST /api/admin/orders/<id>/republish` with `{"confirm":true}` → 409; order still `DRAFT`.
12. **Admin cancel** of an IN_PROGRESS staging order via the cancel route → 200, order `CANCELLED`.
13. **Readability:** customer, booster and admin can open COMPLETED and IN_PROGRESS order workspaces, chat history and Riot data as before.
14. Check server logs for Prisma errors on `paymentVerifiedAt` or `AWAITING_PAYMENT` (would indicate a deploy-order problem).
15. Run `next build` in the staging pipeline; it must succeed.

**D. Sign-off before production**
16. Business/ops decisions recorded for every row in the legacy report (§6).
17. Stakeholders informed that the marketplace will be empty and republishing disabled until payments ship.
18. Production repeats A → C in the same order: backup, `migrate status`, report, `migrate deploy`, verify, then deploy the code.

Production readiness is **not** claimed by this report.
