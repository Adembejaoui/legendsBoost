# Phase 1: Completion and Staging Readiness

**Date:** 2026-11-12
**Builds on:** `docs/ORDER-PAYMENT-FINANCIAL-AUDIT.md`, `docs/PHASE-1-ORDER-SAFETY-REPORT.md`
**Scope:** close the remaining Phase 1 safety gaps and prepare a verifiable staging rollout. No Stripe, no financial models, commission untouched, atomic claim logic untouched.

Nothing was executed against any database. No migration was applied. No `prisma migrate dev`/`reset`/`deploy`/`resolve`/`status` was run, and the legacy report was not run against any database. Build and test runs used an unreachable dummy `DATABASE_URL`/`DIRECT_URL` (`127.0.0.1:1`) so nothing could connect to the database configured in `.env`.

---

## 0. Verdict

| Decision | Verdict |
|---|---|
| Phase 1 application code (review / merge) | **GO.** All Part A items implemented and tested; no new TypeScript, lint or test failures. |
| Running the read-only legacy report against **staging** | **GO**, with `--expect-host` (§6.2). |
| Deploying to **staging** | **NO-GO** until blockers B1–B4 are resolved. |
| Deploying to **production** | **NO-GO.** Requires a passed staging run (§7) first. |

**Blockers for staging:**

| # | Blocker | Why it blocks | Owner |
|---|---|---|---|
| B1 | **RESOLVED 2026-11-12** (see `docs/TYPESCRIPT-BUILD-REMEDIATION.md`): `tsc` 0 errors, `next build` passes. *Original:* **`next build` fails type-checking** on 40 pre-existing TypeScript errors (§4). | Vercel runs `npm run build`, so no deployment can be produced. Must be fixed properly, not suppressed (`ignoreBuildErrors` was deliberately not used). | Engineering |
| B2 | **Edited, already-applied migration** `20261102210000_simplify_order_statuses`: the working-tree file no longer matches the checksum recorded in the database (§5.1). | Existing environments and fresh environments need *different* file contents; one must be chosen before any migration command runs. | Engineering lead / DBA |
| B3 | **Six pending migrations, one of which must be resolved rather than run** (§5.2). The staging database's actual migration state is unknown. | Running `migrate deploy` blindly against a database that already has these tables fails, or worse, partially applies. | Engineering / DBA |
| B4 | **All of this work is uncommitted** (Phase 1 and the earlier workspace/chat/Riot/support work it depends on). | A staging deployment is built from git. The commit must be prepared deliberately, and must take the B2 decision for the edited migration into account. | Engineering |

---

## 1. Changes implemented (Part A)

| # | Requirement | Implementation |
|---|---|---|
| 1 | Restrict order creation to authenticated CUSTOMER users | `POST /api/orders` returns 401 unauthenticated and 403 for BOOSTER and ADMIN, before reading the body. The role comes from the DB on every request (`getSessionUser`). The catalog gate from Phase 1 still applies after it. |
| 2 | Customer cancellation of eligible unpaid orders | New `POST /api/orders/:orderId/cancel` (CUSTOMER only) → `cancelOrderByCustomer()` in `lib/orders/cancellation.service.ts`. Eligible: `AWAITING_PAYMENT`, or legacy `PENDING` with no verified payment and no active booster assignment. Refused with 409 and a reason: paid orders (refund flow not built), `IN_PROGRESS`/`PAUSED`, `DRAFT`, `COMPLETED`, `CANCELLED`. Non-owner → **404** (no id probing). The service re-reads the role from the DB. The write is a conditional update `where { id, userId, status ∈ {AWAITING_PAYMENT, PENDING}, paymentVerifiedAt: null }`, so a payment verified concurrently always wins. Audited as `ORDER_CANCELLED` with `{ actorUserId, cancelledBy: "CUSTOMER", previousStatus, reason }`. Notification is idempotent (`dedupeKey ORDER_CANCELLED:<id>`). Optional reason, max 500 characters, unknown body fields rejected. The workspace shows a "Cancel order" control only when the server computes `access.canCancelOrder`. |
| 3 | Admin cancellation of DRAFT orders with mandatory reason | New `POST /api/admin/orders/:orderId/cancel` (ADMIN only, `{ confirm: true, reason }`, reason 3–500 characters, enforced in **both** route and service) → `cancelDraftOrder()` in `lib/orders/draft-admin.service.ts`. Only `DRAFT`, no active assignment, and **refused for a paid draft** (cancelling it would need a refund). Conditional update `where { id, status: DRAFT, paymentVerifiedAt: null }`. Audited `ORDER_CANCELLED` with `{ actorUserId, cancelledBy: "ADMIN", previousStatus: "DRAFT", reason }`; customer notified. The DraftEditor has a "Cancel order…" control with a required reason. |
| 4 | Preserve booster abandonment and assignment history | Unchanged. Tested: after abandon then admin cancel, the assignment row is still `RELEASED` with `endReason "ABANDONED: <reason>"` and the `BOOSTER_ABANDONED` event remains. No assignment row is ever deleted or rewritten by the new paths. |
| 5 | Admin republish cannot bypass payment verification | Phase 1 gate retained and re-tested (409 for unpaid; cancelled drafts cannot be republished). |
| 6 | No API endpoint or background process can publish an unpaid order | See §2. Admin release of an **unpaid** order now goes to `DRAFT` (admin review) instead of `PENDING`. Paid orders still return to `PENDING`. `reassignOrder` (unrouted) now requires a live, paid order. Legacy `startAssignment` no longer writes status unconditionally, so it cannot revive cancelled, completed or draft orders. A static test fails if any code in `app/`, `lib/`, `components/` or `scripts/` ever writes `paymentVerifiedAt`. No background jobs, cron or server actions exist (the only `setInterval`s clear in-memory rate-limit maps). |
| 7 | Ownership and role permissions server-side | Authorization matrix in §3. Every cell for the new and changed endpoints is covered by a test. Cells for unchanged endpoints marked † were verified by code review only. |

Atomic claim logic was not changed (no defect found). The two-booster race test from Phase 1 still passes.

### Files

**New**
- `lib/orders/cancellation.service.ts`
- `app/api/orders/[orderId]/cancel/route.ts`
- `app/api/admin/orders/[orderId]/cancel/route.ts`
- `components/orders/workspace/CustomerCancelOrder.tsx`
- `__tests__/orders/phase1-completion.test.ts` (41 tests)
- `__tests__/orders/support/fake-order-db.ts` (shared in-memory Prisma fake; not a test file)
- `__tests__/scripts/report-legacy-orders.test.ts` (7 tests)
- `docs/PHASE-1-COMPLETION-AND-STAGING-READINESS.md`

**Modified**
- `app/api/orders/route.ts`: CUSTOMER-only.
- `lib/assignments/service.ts`: admin release unpaid → DRAFT (+ `ORDER_MOVED_TO_DRAFT` event, no `ORDER_REOPENED` notification); conditional `startAssignment` and `reassignOrder`; `loadAssignmentAndOrder` return type now declares `paymentVerifiedAt` (the row already contained it).
- `lib/orders/draft-admin.service.ts`: `cancelDraftOrder`.
- `lib/orders/workspace-types.ts`, `lib/orders/workspace-data.ts`: `access.canCancelOrder`.
- `components/orders/workspace/OrderStatusPanel.tsx`: renders the customer cancel control.
- `app/dashboard/admin/orders/[orderId]/DraftEditor.tsx`: admin cancel with reason.
- `scripts/report-legacy-orders.mjs`: session-level read-only guard, `--expect-host`, credential redaction.
- `__tests__/orders/lifecycle.test.ts`: admin-release test split into paid → PENDING and unpaid → DRAFT.
- `docs/PHASE-1-ORDER-SAFETY-REPORT.md`: staging step 3 marked superseded (see §5.2).

No migration, schema or previously applied migration file was changed in this task.

---

## 2. Every path that can set an order to `PENDING` or hand it to a booster

| Path | Unpaid order | Paid order |
|---|---|---|
| `POST /api/orders` | created `AWAITING_PAYMENT` (CUSTOMER only, catalog-gated; no catalog item is purchasable today) | n/a |
| `claimOrder` (`POST /api/booster/orders/:id/claim`) | refused (pre-check + conditional update) | atomic claim |
| `acceptAssignment` (legacy) | refused (conditional update) | allowed |
| `republishDraftOrder` (`POST /api/admin/orders/:id/republish`) | **409** | DRAFT → PENDING |
| `releaseAssignment` as ADMIN (`POST /api/booster/orders/:id/release`) | **→ DRAFT** (new) | → PENDING |
| `releaseAssignment` / `abandonOrder` as BOOSTER | → DRAFT | → DRAFT |
| `reassignOrder` (no route) | **refused** (new) | allowed |
| `startAssignment` (legacy) | only on an `IN_PROGRESS` order (new) | same |
| `getAvailableOrders` (marketplace) | excluded by query and in-memory filter | listed |
| Writes to `paymentVerifiedAt` | none anywhere in application code (static test) | none (future verified webhook only) |
| Background jobs / cron / server actions | none exist | none |

---

## 3. Authorization matrix (server-side)

† = unchanged endpoint behaviour verified by code review, not by a test.

| Endpoint | Unauthenticated | CUSTOMER (owner) | CUSTOMER (other) | BOOSTER | ADMIN |
|---|---|---|---|---|---|
| `POST /api/orders` | 401 | 201 if purchasable, else 403 | n/a | **403** | **403** |
| `POST /api/orders/:id/cancel` | 401 | 200 if eligible, else 409 | **404** | **403** | **403** |
| `POST /api/admin/orders/:id/cancel` | 401 † | 403 | 403 | 403 | 200 (DRAFT, unpaid, reason) / 400 / 409 |
| `POST /api/admin/orders/:id/republish` | 401 † | 403 (service) | 403 (service) | 403 (service) | 409 unpaid / 200 paid |
| `POST /api/booster/orders/:id/cancel` | 401 † | **403** | 403 † | **403** | 200 |
| `POST /api/booster/orders/:id/abandon` | 401 † | 403 † | 403 † | 200 for the assigned booster; 403 for others (service) | 403 † |
| `POST /api/booster/orders/:id/claim` | 401 † | 403 † | 403 † | 400 unpaid / 201 paid / 409 race (service) | 403 † |
| `GET /api/orders/:id` | 401 † | 200 | 404 † | 404 † | 404 † (admins use the workspace) |

---

## 4. Quality checks

| Check | Command | Result |
|---|---|---|
| Prisma validation | `npx prisma validate` | **valid** |
| Changed-file lint (new files) | `npx eslint <8 new files>` | **clean** |
| Changed-file lint (modified files) | `npx eslint <8 modified files>` | 6 errors / 4 warnings, **all on pre-existing lines** (`any` casts in `app/api/orders/route.ts` and `lib/assignments/service.ts`, unused `validateAssignmentTransition` / `OrderAndAssignment` / `err`, `prefer-const` on the original `where`) |
| Targeted tests | `npx vitest run __tests__/orders/phase1-completion.test.ts __tests__/scripts` | **41/41** and **7/7** pass |
| Phase 1 tests | `npx vitest run __tests__/orders/marketplace-safety.test.ts` | 35/35 pass |
| Full suite | `npx vitest run` | **382 passed / 20 failed** (402 tests, 29 files) |
| TypeScript | `npx tsc --noEmit -p .` | **40 errors, identical set to the pre-Phase-1 baseline** (diffed file+message) |
| Production build | `npx next build` (dummy DB URLs) | **Compiles successfully** (Turbopack); **fails at "Running TypeScript"** on the same 40 pre-existing errors; none in Phase 1 files |

### Test history

| | Tests passed | Tests failed |
|---|---|---|
| Before Phase 1 | 296 | 22 |
| After Phase 1 | 333 | 20 |
| After this task | **382** | **20** |

**Newly introduced failures: none.** The 20 remaining failures were all failing before Phase 1 and are untouched:

| File | Failures | Cause (pre-existing) |
|---|---|---|
| `__tests__/security/rate-limit.test.ts` | 10 | tests target an old `@/lib/security/sanitize` rate-limit API (`ORDER_MESSAGE_RATE_LIMIT`, `clearRateLimit`, `keyPrefix`) |
| `__tests__/security/sanitize.test.ts` | 9 | expectations differ from the current sanitizer |
| `__tests__/assignments.service.test.ts › pauseAssignment` | 1 | stale assertion on the old return shape |
| `__tests__/auth/password.test.ts` | suite fails to load | pre-existing |

Two TypeScript errors that *were* introduced during this task, in the new test files (regex `s` flag below the ES2018 target, and the repo's `ProcessEnv` augmentation), were found by the build and fixed.

**Test runner:** run Vitest from `C:\Users\tun\Desktop\legendsboost` (upper-case `C:`). From the VS Code default `c:\…` path every file fails with "failed to find the runner".

### Remaining TypeScript / build blockers (B1)

All pre-existing; none are in Phase 1 code. Listed so they can be fixed on their own, without suppression:

| File | Errors | Nature |
|---|---|---|
| `__tests__/security/rate-limit.test.ts` | 19 | tests out of date with `lib/security/sanitize` API |
| `__tests__/security/sanitize.test.ts` | 4 | `null`/`undefined` passed to `string` params |
| `__tests__/riot/sync-integrity.test.ts` | 3 | `Route` type lacks `status/body/headers` |
| `__tests__/assignments/reassignment-revocation.test.ts` | 2 | mock object lacks `findMany` |
| `__tests__/support/ticket-transitions.test.ts` | 2 | mock object lacks `create` |
| `__tests__/riot/riot-remediation.test.ts` | 1 | fake not assignable to `RawQueryClient` |
| `components/dashboard/customer/CustomerOrderFilter.tsx` | 3 | `useSearchParams()` nullable (Next 16 types) |
| `components/dashboard/DashboardShell.tsx` | 1 | nullable string |
| `app/checkout/review/review-client.tsx` | 1 | `useSearchParams()` nullable |
| `components/payment/PaymentPageClient.tsx` | 1 | `useSearchParams()` nullable |
| `components/support/SupportTicketList.tsx` | 1 | undefined name `User` |
| `lib/support/service.ts` | 1 | local `SupportTicketCategory` has `ACCOUNT_ISSUE`, Prisma enum does not (**real schema/code mismatch**) |
| `package/dist/esm/client/dev/hot-reloader/app/hot-reloader-app.js` | 1 | a vendored Next.js `package/` directory is inside the TypeScript project; it should be excluded in `tsconfig.json` or removed (decision needed: it also inflates `eslint .` to 80k findings) |

Of these, 31 are in tests, 8 are in app code, and 1 is in the vendored directory. Excluding `__tests__` from the *build* type-check alone would not be enough: the 8 app-code errors and the `package/` error still fail it.

---

## 5. Migration safety findings (Part C)

### 5.1 Edited, already-applied migration `20261102210000_simplify_order_statuses`

| Version of the file | SHA-256 (what Prisma stores as `checksum`) |
|---|---|
| Committed in git (`HEAD`, commit `3a65f17`), LF | **`c3fa99879bb935db…b34dd`** |
| Same content with CRLF line endings | `5cf8ba353808f9c4…0ca0a9` |
| **Current working tree** (uncommitted edit, LF) | **`b2367377323f8a77…5ab43cca`** |

`docs/PRISMA-MIGRATION-FINAL-DECISION.md` records that the inspected database's finished row for this migration has checksum `c3fa9987…`. That is the **committed** file. The uncommitted edit (2026-11-12) changes the checksum.

The two versions are each correct for a different kind of database:

| | Committed version (`c3fa…`) | Edited version (`b236…`) |
|---|---|---|
| Existing DB that recorded `c3fa…` | checksum matches | mismatch: `prisma migrate dev` will report "was modified after it was applied" and offer a **reset** |
| Fresh DB / shadow DB replay | **fails** with `42804` (sets the default to `"OrderStatus_next"` before the type change, line 13) | replays correctly |

The baseline migration `20261111000000` assumes fresh databases can replay the history ("Fresh databases (dev, CI, shadow) apply it normally"). That only works with the edited version. The migration history is therefore internally inconsistent, and someone must choose:

- **Option A (recommended for this rollout):** restore the committed content (`git restore prisma/migrations/20261102210000_simplify_order_statuses/migration.sql`) so every existing environment keeps checksum parity. Accept that fresh-database replay is broken. Create fresh dev/CI databases from a schema dump instead, and fix replay later with a proper squash/baseline.
- **Option B:** keep the edited content and have a DBA update the stored checksum of that one `_prisma_migrations` row to `b2367377…` in each existing environment, as a reviewed, logged metadata change.

I did not make this choice or change the file. It is blocker **B2**. Whatever is chosen, the file **deployed** must hash to the checksum recorded in the target database (§7, step 4).

**Line endings:** `core.autocrlf=true` on this machine and there is no `.gitattributes`. A Windows checkout can turn migration files into CRLF and change every checksum. Run migration commands from Linux/CI (as Vercel does) or verify hashes first. Recommended, not applied: `.gitattributes` with `prisma/migrations/**/*.sql text eol=lf`.

### 5.2 Pending migrations

The database inspected on 2026-11-10 had **8** migrations recorded (up to `20261102210000`). The repository now has 14. The six newer ones are untracked in git and, as far as the evidence goes, unapplied anywhere:

| Migration | Nature | How it must be applied to an existing (production-like) DB |
|---|---|---|
| `20261111000000_baseline_chat_support_notification_tables` | **Baseline.** Describes tables already present in production (created outside Prisma). Header: "DO NOT EXECUTE AGAINST PRODUCTION". | **`prisma migrate resolve --applied`**, never executed, and only after verifying the tables exist (§7, step 6). Running it would fail on `CREATE TYPE` / `CREATE TABLE` of existing objects. |
| `20261112000000_realtime_private_channel_policies` | Supabase `realtime.messages` RLS policy | `migrate deploy` (Supabase only) |
| `20261112100000_message_sender_set_null_and_notification_order_fk` | FK / nullability changes, one transaction | `migrate deploy` |
| `20261112200000_order_workspace_draft_riot_matches` | adds `DRAFT`, `completedAt`, `dedupeKey`, Riot tables | `migrate deploy` |
| `20261112230000_riot_sync_integrity` | Riot columns + `riotApiThrottle` | `migrate deploy` |
| `20261113000000_order_payment_gate` (Phase 1) | `AWAITING_PAYMENT`, `paymentVerifiedAt` | `migrate deploy` |

The current working-tree application code depends on **all** of them (DRAFT status, `completedAt`, notification `dedupeKey`, Riot tables, `paymentVerifiedAt`). Deploying the code without them breaks most order queries.

### 5.3 The Phase 1 migration itself (`20261113000000_order_payment_gate`, SHA-256 `4789b312…0309d3f`, LF)

- Two statements, both additive and idempotent (`ADD VALUE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). No row is read or written, no `DO $$` blocks, the new enum value is not used in the same script, and no default changes.
- `ADD COLUMN` of a nullable column without a default is a metadata-only change on PostgreSQL 11+. It takes a brief `ACCESS EXCLUSIVE` lock on `"order"`, with no table rewrite.
- **Rollback:** the old code ignores the extra column and enum value, so rolling back the *code* is safe. The schema change needs no rollback. PostgreSQL cannot drop an enum value; leaving `AWAITING_PAYMENT` in place is harmless.
- Generated offline with `prisma migrate diff --from-schema … --to-schema …`. Its output is exactly the schema delta.

### 5.4 Prisma configuration

- `prisma.config.ts` uses `env('DIRECT_URL')` for CLI/migrations and loads `.env` via `dotenv/config`. **Every Prisma CLI command run from a developer machine targets whatever `.env` says.** That may be production (the existing migration docs describe the configured datasource as production). For staging commands, always set `DIRECT_URL` explicitly in the shell (§7), and verify the host first.
- `DIRECT_URL` must be a direct connection or the session pooler (port **5432**), never the transaction pooler (port 6543): enum `ADD VALUE` and multi-statement migrations are unsafe through transaction pooling.
- `migration_lock.toml`: `provider = "postgresql"`. Consistent.

---

## 6. Legacy order reconciliation (Part B)

### 6.1 Script review: `scripts/report-legacy-orders.mjs`

| Requirement | Status |
|---|---|
| Strictly read-only | Only `SELECT` statements. Two independent guards: `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` (added in this task) and `BEGIN READ ONLY`, ending in `ROLLBACK`; never `COMMIT`. Any write would fail with SQLSTATE 25006. Covered by a static test. |
| Requires explicit `LEGACY_REPORT_DATABASE_URL` | Yes. Does not import `dotenv` and never reads `DATABASE_URL`/`DIRECT_URL`. Exits 2 without it, even when `DATABASE_URL` is set (tested). |
| Never prints credentials | Prints the host only (URL `host`, no user info). Error output is passed through `redact()`, which removes the full URL, the password and any `postgres://` string (added in this task). An invalid URL is not echoed. All tested with sentinel passwords. |
| Wrong-target protection | New `--expect-host=<host>`: refuses to connect unless the URL's host matches (tested). |
| No production execution | Not executed anywhere by me. The procedure below targets staging only. |
| Output | Order ids, statuses, timestamps, booster/customer **ids** only (no names or e-mails). |

### 6.2 Running it against staging

```bash
# Linux/CI or Git Bash. Read the secret without echoing it or saving it in history.
read -rs LEGACY_REPORT_DATABASE_URL && export LEGACY_REPORT_DATABASE_URL
node scripts/report-legacy-orders.mjs --expect-host=db.<STAGING_REF>.supabase.co --json > legacy-before.json
node scripts/report-legacy-orders.mjs --expect-host=db.<STAGING_REF>.supabase.co          # human-readable
unset LEGACY_REPORT_DATABASE_URL
```

`legacy-*.json` contains order and user ids. Store it with the staging release notes, not in git.

### 6.3 Reconciliation plan (no order is ever marked paid automatically)

Phase 1 provides **no** way to mark an order as paid, and none should be added before Stripe. Each row of the report needs a recorded business decision. Which actions are available in-app today:

| Legacy status | Situation after Phase 1 | Decision options | In-app action available today |
|---|---|---|---|
| **PENDING** | Hidden from marketplace; unclaimable | (a) customer cancels; (b) ops contacts the customer and keeps it until Stripe; (c) ops cancels | (a) **yes**, customer `Cancel order` (new). (c) **no** admin cancel for PENDING yet: ask the customer, or wait for Phase 5. Admin release/republish cannot publish it. |
| **IN_PROGRESS / PAUSED** | Booster keeps working; can complete or abandon | (a) let it finish and record it as an unpaid/legacy job; (b) stop work: admin cancels via `/api/booster/orders/:id/cancel`; (c) admin releases it, which now sends unpaid orders to **DRAFT**, not the marketplace | all available (admin only for b/c) |
| **COMPLETED** | Read-only history | Record each as "legacy, no payment record". It must be **excluded** from future booster earnings unless finance explicitly approves (Phase 6 must read this list). | none needed |
| **DRAFT** | Cannot be republished | (a) admin cancels with a reason (new); (b) hold until Stripe | (a) **yes** (new, reason mandatory) |
| **CANCELLED** | Final | Check whether any money was taken out-of-band | none |
| **AWAITING_PAYMENT** | Only possible if a service becomes purchasable | Customer may cancel | yes |
| *anomaly: `paymentVerifiedAt` already set* | Should be impossible | Investigate (manual SQL write) before anything else | — |

Record decisions per order id in the release ticket. When Stripe ships, unpaid legacy orders do **not** become payable automatically; that needs its own migration plan.

---

## 7. Staging verification procedure (Part D)

Run from a Linux shell or CI runner with a clean checkout of **the exact commit to be deployed** (after B2/B4). Use **staging** secrets from the secret manager only. Never use production credentials, and never run `migrate dev` or `migrate reset`. Stop at the first failed check.

### Step 1: Load staging credentials (no echo, no history)

```bash
read -rs STAGING_DIRECT_URL && export STAGING_DIRECT_URL
export DIRECT_URL="$STAGING_DIRECT_URL"     # overrides .env for prisma.config.ts
export DATABASE_URL="$STAGING_DIRECT_URL"
```

### Step 2: Database URL verification (prints host/port/db only)

```bash
node -e 'const u=new URL(process.env.DIRECT_URL); console.log({host:u.hostname, port:u.port, db:u.pathname.slice(1)})'
```

Expected: the **staging** project host, port `5432`, database `postgres`. If the host is production, or the port is 6543: **stop**.

### Step 3: Backup

Take both before any change:

```bash
# Supabase dashboard (staging project) → Database → Backups: note the latest backup / PITR timestamp.
pg_dump "$STAGING_DIRECT_URL" --format=custom --no-owner --file="staging-pre-phase1-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_restore --list staging-pre-phase1-*.dump | head     # sanity check the dump is readable
```

The dump contains user data: store it encrypted, outside the repository.

### Step 4: Migration history and checksum review (read-only)

```bash
npx prisma migrate status            # record the full output in the release ticket

psql "$STAGING_DIRECT_URL" -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on;" -c \
 "SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at;"

sha256sum prisma/migrations/*/migration.sql     # from the deployment checkout (LF)
file prisma/migrations/*/migration.sql          # must not say "CRLF"
```

Decide the case:

| Observed | Case | Continue? |
|---|---|---|
| 8 finished rows up to `20261102210000`, its checksum equals the deployed file's hash, nothing else applied | **Case A**: matches the inspected DB | yes, steps 5–9 |
| Checksum of `20261102210000` ≠ deployed file | B2 not resolved for this environment | **stop** |
| Any row with `finished_at IS NULL AND rolled_back_at IS NULL` | failed migration in progress | **stop** (DBA) |
| Some of the six newer migrations already recorded | partially migrated | **stop**, re-plan with exact state |
| No `_prisma_migrations` / empty DB | **Case B**: fresh database | **stop**: committed history cannot replay on a fresh DB (§5.1). Needs the B2 decision and a separate plan. |

### Step 5: Review the SQL that will run

```bash
for m in 20261112000000_realtime_private_channel_policies 20261112100000_message_sender_set_null_and_notification_order_fk \
         20261112200000_order_workspace_draft_riot_matches 20261112230000_riot_sync_integrity 20261113000000_order_payment_gate; do
  echo "=== $m"; cat "prisma/migrations/$m/migration.sql"; done | less
```

Confirm: no `DROP TABLE`, no `DELETE`, no `UPDATE` of business rows, no `TRUNCATE`. (The 20261112100000 migration drops and re-adds two foreign-key *constraints* inside one transaction. That is expected.)

### Step 6: Baseline (Case A only): verify, then mark as applied without executing

```bash
psql "$STAGING_DIRECT_URL" -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on;" -c \
 "SELECT to_regclass('public.notification') AS notification, to_regclass('public.\"orderConversation\"') AS conv,
         to_regclass('public.\"orderMessage\"') AS msg, to_regclass('public.\"supportTicket\"') AS ticket,
         to_regclass('public.\"supportMessage\"') AS smsg,
         (SELECT COUNT(*) FROM pg_type WHERE typname IN ('NotificationType','SupportTicketStatus','SupportTicketPriority','SupportTicketCategory')) AS enums;"
```

All five tables are non-null and `enums = 4` → `npx prisma migrate resolve --applied 20261111000000_baseline_chat_support_notification_tables`.
Any table missing → **stop** (the environment is not production-like).

### Step 7: Read-only legacy report, before migration

§6.2 → `legacy-before.json` (`gateColumnPresent: false`).

### Step 8: Apply

```bash
npx prisma migrate status     # expect exactly 5 pending: 20261112000000 … 20261113000000
npx prisma migrate deploy     # never migrate dev / reset
npx prisma migrate status     # expect "Database schema is up to date"
```

### Step 9: Post-migration verification (read-only)

```bash
psql "$STAGING_DIRECT_URL" -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on;" \
 -c "SELECT enum_range(NULL::\"OrderStatus\");" \
 -c "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='order' AND column_name IN ('paymentVerifiedAt','completedAt');" \
 -c "SELECT COUNT(*) AS paid_markers FROM \"order\" WHERE \"paymentVerifiedAt\" IS NOT NULL;" \
 -c "SELECT status, COUNT(*) FROM \"order\" GROUP BY status ORDER BY status;" \
 -c "SELECT status, COUNT(*) FROM \"orderBoosterAssignment\" GROUP BY status ORDER BY status;" \
 -c "SELECT conname FROM pg_constraint WHERE conname IN ('orderBoosterAssignment_active_order_check','notification_orderId_fkey','orderMessage_senderId_fkey','supportMessage_senderId_fkey');"
```

Expected: enum includes `DRAFT` and `AWAITING_PAYMENT`; both columns nullable timestamps; `paid_markers = 0`; order and assignment counts **identical** to `legacy-before.json`; all four constraints present. Then run the report again → `legacy-after.json` and diff the summaries:

```bash
node -e 'const a=require("./legacy-before.json").summary,b=require("./legacy-after.json").summary; console.log(JSON.stringify(a.map(r=>[r.status,r.total]))===JSON.stringify(b.map(r=>[r.status,r.total]))?"COUNTS MATCH":"COUNTS DIFFER")'
```

### Step 10: Code deployment (requires B1 fixed)

Deploy the same commit to the staging environment (e.g. a Vercel preview with **staging** env vars). Confirm the build log shows "Compiled successfully" **and** a passing TypeScript step. Never use `ignoreBuildErrors`. Watch logs for Prisma errors mentioning `paymentVerifiedAt`, `AWAITING_PAYMENT`, `completedAt` or `dedupeKey`: those mean a migration/code mismatch.

### Step 11: Authorization checks (real staging sessions)

Use three staging test accounts (CUSTOMER, approved BOOSTER, ADMIN) and their session cookies (`next-auth.session-token`, or `__Secure-next-auth.session-token` over HTTPS). Never use production accounts.

```bash
B=https://<staging-host>
C="Cookie: __Secure-next-auth.session-token=<customer>"; K="Cookie: __Secure-next-auth.session-token=<booster>"; A="Cookie: __Secure-next-auth.session-token=<admin>"
J="Content-Type: application/json"
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }

code -X POST $B/api/orders -H "$J" -d '{"gameSlug":"league-of-legends","serviceSlug":"rank-boost"}'                  # 401
code -X POST $B/api/orders -H "$K" -H "$J" -d '{"gameSlug":"league-of-legends","serviceSlug":"rank-boost"}'       # 403 (booster)
code -X POST $B/api/orders -H "$A" -H "$J" -d '{"gameSlug":"league-of-legends","serviceSlug":"rank-boost"}'       # 403 (admin)
code -X POST $B/api/orders -H "$C" -H "$J" -d '{"gameSlug":"league-of-legends","serviceSlug":"rank-boost","configuration":{}}'  # 403 not purchasable
code -X POST $B/api/orders/<other-customers-order>/cancel -H "$C" -H "$J" -d '{}'                              # 404
code -X POST $B/api/orders/<any-order>/cancel -H "$K" -H "$J" -d '{}'                                          # 403
code -X POST $B/api/admin/orders/<draft-id>/cancel -H "$K" -H "$J" -d '{"confirm":true,"reason":"test"}'       # 403
code -X POST $B/api/admin/orders/<draft-id>/cancel -H "$A" -H "$J" -d '{"confirm":true}'                        # 400 (reason)
code -X POST $B/api/booster/orders/<in-progress-id>/cancel -H "$K" -H "$J" -d '{"assignmentId":"<id>"}'        # 403
```

After each refused call, confirm in SQL that the order's `status` and `updatedAt` are unchanged.

### Step 12: Marketplace payment gate

1. As the booster, open `/dashboard/booster/available-orders`: **no** legacy PENDING orders are listed.
2. `code -X POST $B/api/booster/orders/<legacy-pending-id>/claim -H "$K"` → `400` with "payment has not been verified"; no new `orderBoosterAssignment` row.
3. As the owning customer, cancel one legacy PENDING test order in the workspace → `CANCELLED`, `ORDER_CANCELLED` event with `cancelledBy: CUSTOMER`.

### Step 13: Atomic claim

The claim race needs a **paid** order, and none exist. Rely on the unit tests (`marketplace-safety.test.ts › two boosters cannot claim the same (paid) order`; the conditional update plus the DB unique index `orderBoosterAssignment_activeOrderId_key`) and verify the index exists:

```bash
psql "$STAGING_DIRECT_URL" -c "SET default_transaction_read_only = on;" -c "SELECT indexname FROM pg_indexes WHERE indexname='orderBoosterAssignment_activeOrderId_key';"
```

A live race test would need a staging-only synthetic order with `paymentVerifiedAt` set by hand. That is a deliberate manual "mark as paid", so it must be approved separately, use an obviously synthetic order created for the purpose, and **never** touch a legacy order.

### Step 14: Abandonment and admin republish/cancel

1. Booster abandons an IN_PROGRESS staging test order with a reason → order `DRAFT`, assignment `RELEASED` with `ABANDONED: <reason>`, booster loses workspace access.
2. Admin opens `/dashboard/admin/orders/<id>`: republish is replaced by the "no verified payment" notice; `POST …/republish` `{"confirm":true}` → `409`.
3. Admin uses "Cancel order…" with a reason → `CANCELLED`; the event holds the reason; the assignment row is unchanged.
4. Admin release of another unpaid IN_PROGRESS test order → `DRAFT` (not PENDING).

### Step 15: Existing order integrity

- Step 9 counts are unchanged.
- Customers, boosters and admins can open COMPLETED and IN_PROGRESS workspaces, chat history and Riot data.
- `SELECT COUNT(*) FROM "orderBoosterAssignment"` and `SELECT COUNT(*) FROM "orderEvent"` are greater than or equal to the pre-migration values (equal plus test actions only).

### Step 16: Sign-off

Record in the release ticket: `migrate status` before/after, checksum table, backup id, both legacy reports, results of steps 11–15, and the per-order reconciliation decisions (§6.3). Production repeats steps 1–10 with production credentials handled by the production owner, only after this sign-off.

---

## 8. Remaining risks

| ID | Risk | Severity |
|---|---|---|
| R1 | Deploy order: the code needs all six pending migrations; apply them first (§5.2). | High (operational) |
| R2 | B2: inconsistent migration history; fresh databases cannot replay with the committed file. | High (process) |
| R3 | Prisma CLI on developer machines reads `.env`, which may point at production. Always export staging `DIRECT_URL` explicitly. | High (process) |
| R4 | Legacy unpaid IN_PROGRESS orders can still be completed (by design; reconcile per §6.3). | Medium |
| R5 | No admin cancel for legacy PENDING/AWAITING_PAYMENT orders (only customer cancel and DRAFT admin cancel). | Medium (Phase 5) |
| R6 | Admins can still edit `price`/`currency` on DRAFT orders (audit P1-2). Harmless while no payment exists; must be removed before Stripe. | Medium |
| R7 | Supabase RLS coverage on `public` tables still unverified (audit S11). | High until verified |
| R8 | `POST /api/orders` has no rate limit or idempotency key. Moot while nothing is purchasable. | Medium |
| R9 | `lib/support/service.ts` uses an `ACCOUNT_ISSUE` category that the database enum does not have, so creating such a ticket would fail at runtime (found via the build blockers). | Medium (unrelated to Phase 1) |
| R10 | Vendored `package/` directory inside the TypeScript/ESLint project. | Low |
| R11 | The legacy PENDING status description still says "available to be claimed by a booster". | Low (copy) |

---

## 9. Summary

Phase 1 is functionally complete:

- Only customers can create orders.
- Unpaid orders can be cancelled by their owner and never reach boosters.
- Drafts can be cancelled by admins with an audited reason.
- No code path can publish an unpaid order or write the payment marker.
- Booster abandonment and assignment history are intact.
- All checks show zero newly introduced failures.

The system is **not** ready for staging deployment. The build is blocked by pre-existing TypeScript errors (B1). The migration history needs a decision (B2) and a carefully sequenced, state-checked rollout (B3). None of the work is committed yet (B4).
