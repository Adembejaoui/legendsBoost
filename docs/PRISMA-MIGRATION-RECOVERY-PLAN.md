# Prisma Migration Recovery Plan

**Date:** 2026-11-10  
**Scope:** Read-only investigation (no DB reset, no migration/history edits, no `db push`, no destructive SQL, no migration apply/resolve, no source-code changes)  
**Target migration:** `20261102210000_simplify_order_statuses`  
**Context:** P0 security-remediation schema changes (Notification.order FK, `OrderMessage.senderId` nullable relation, `SupportMessage.senderId` nullable relation) cannot be applied because Prisma migration/shadow replay fails on the pre-existing migration above.

---

## 1. Executive summary

- **Reported failure:** Column type mismatch in the **shadow database** when replaying `20261102210000_simplify_order_statuses`.
- **Root cause (most likely, from static SQL analysis):** The migration sets `order.status` default to `'PENDING'::"OrderStatus_next"` **while the column is still typed as `"OrderStatus"`** (old enum). PostgreSQL rejects a default expression whose type is incompatible with the column type (`OrderStatus_next` vs `OrderStatus`), causing replay to fail on a fresh/shadow database.
- **CLI-observed state (configured datasource / DIRECT_URL):** `prisma migrate status` reports **8 migrations found** and **“Database schema is up to date!”** (PostgreSQL). This indicates the migration is recorded as applied in that environment and does **not** by itself prove a currently failed/half-applied state there.
- **Environment attribution:** Failure is **confirmed in shadow replay context by report**. **Development/production application-state impact cannot be fully confirmed read-only without per-environment DB introspection and `_prisma_migrations` row details** (CLI execution succeeded but did not emit row data in this session). Treat dev/staging/prod as separate verification targets.
- **Schema vs live DB drift (security remediation, pending):** Read-only diff (`--from-config-datasource --to-schema`) indicates the connected DB is missing `notification.orderId -> order.id` FK and still has `orderMessage.senderId`/`supportMessage.senderId` as **NOT NULL** with `ON DELETE CASCADE` FKs, while current schema requires nullable senders with `ON DELETE SET NULL` and notification order relation. These are **unapplied schema changes** blocked by migration workflow issues.
- **Constraint/data risk (pre-check):** Read-only orphan check for `notification.orderId` referencing missing orders executed successfully (result rows not emitted by CLI in-session); **must be re-run and reviewed before adding FK** in each environment.

> No recovery actions were executed. All SQL/steps below are proposals for review.

---

## 2. Artifacts inspected (read-only)

| Artifact | Path / source | Notes |
|---|---|---|
| Prisma schema | `prisma/schema.prisma` | Current model/enum/FK definitions (incl. security changes) |
| Prisma config | `prisma.config.ts` | Migrations path `prisma/migrations`; datasource URL from `env('DIRECT_URL')` (CLI/migrations). **No credential values recorded.** |
| Migration lock | `prisma/migrations/migration_lock.toml` | `provider = "postgresql"` |
| Failing migration | `prisma/migrations/20261102210000_simplify_order_statuses/migration.sql` | Full SQL reviewed |
| Preceding/related migrations | `20261102151147_phase2a_orders/migration.sql`, `20261102153141_phase2b_assignment/migration.sql`, `20261102153232_phase2b_assignment/migration.sql`, `20261102201109_add_booster_application_workflow/migration.sql` (+ earlier auth/profile migrations) | Status/type evolution traced |
| CLI diagnostics | `npx prisma migrate status` | 8 migrations, DB schema up to date (configured datasource) |
| CLI diagnostics | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` | Live DB → schema drift (security changes pending) |
| CLI diagnostics (read-only DB execute attempts) | `npx prisma db execute --file ...` for `_prisma_migrations` and orphan checks | Executed successfully; row output not emitted in-session (CLI mode) |
| Temp artifact | `prisma/schema.prisma.tmp` | Older snapshot (no orders/assignments/notifications/chat/support models); not authoritative |

---

## 3. Migration history and relevant SQL

### 3.1 `20261102151147_phase2a_orders`
- Creates `"OrderStatus"` enum: `('PENDING','PENDING_REVIEW','IN_PROGRESS','COMPLETED','CANCELLED')`.
- Creates `"order"` table with `status "OrderStatus" NOT NULL DEFAULT 'PENDING'` and `"orderEvent"`.

### 3.2 `20261102153141_phase2b_assignment`
- Creates `"AssignmentStatus"` enum: `('ASSIGNED','ACCEPTED','IN_PROGRESS','COMPLETED','DECLINED','CANCELLED','RELEASED')`.
- Adds enum values to `"OrderStatus"`: `QUEUED`, `ASSIGNED`.
- Creates `"orderBoosterAssignment"` (incl. `status "AssignmentStatus"`, `activeOrderId`, indexes/uniques/FKs).

### 3.3 `20261102153232_phase2b_assignment`
- Adds CHECK constraint `orderBoosterAssignment_active_order_check` allowing active `activeOrderId` only for statuses `('ASSIGNED','ACCEPTED','IN_PROGRESS')` and inactive/null for terminal statuses.

### 3.4 `20261102201109_add_booster_application_workflow`
- Alters `boosterProfile` (application/review/welcome fields, reviewer FK). No `order`/`OrderStatus`/`AssignmentStatus` changes.

### 3.5 `20261102210000_simplify_order_statuses` (failing migration)
**Intent:** collapse legacy order statuses, replace enum type, add `PAUSED` to assignment flow, refresh active-assignment constraint.

**Key statements (in order):**
1. Backfill `order.status` values `QUEUED`/`PENDING_REVIEW` → `PENDING`, `ASSIGNED` → `IN_PROGRESS` (casts to old `"OrderStatus"`).
2. `CREATE TYPE "OrderStatus_next" AS ENUM ('PENDING','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED');`
3. `ALTER TABLE "order" ALTER COLUMN status SET DEFAULT 'PENDING'::"OrderStatus_next";`  **(critical ordering/type issue; see §4)**
4. `ALTER TABLE "order" ALTER COLUMN status TYPE "OrderStatus_next" USING status::text::"OrderStatus_next";`
5. `DROP TYPE "OrderStatus";`
6. `ALTER TYPE "OrderStatus_next" RENAME TO "OrderStatus";`
7. `ALTER TYPE "AssignmentStatus" ADD VALUE 'PAUSED';`
8. Drop/recreate `orderBoosterAssignment_active_order_check` to include `PAUSED` as active.

---

## 4. Root cause analysis

### 4.1 Exact conflicting column/type interaction
| Location | Column/object | Type/expression involved | Conflict |
|---|---|---|---|
| `order.status` (existing, post-2a/2b) | Table column | Enum type `"OrderStatus"` (old set includes legacy values after 2b) | Column remains old type until step 4 |
| Step 3 of simplify migration | Default expression | `'PENDING'::"OrderStatus_next"` (new enum type) | **Default is typed as `OrderStatus_next` but applied to a column still typed as `OrderStatus`**; PostgreSQL type-checks default against column type and rejects incompatible enum types |
| Step 4 | Column type conversion | `USING status::text::"OrderStatus_next"` | Intended conversion is sound **if reached**, but step 3 can abort transaction first |

**Exact mismatch:** `order.status` column type = `"OrderStatus"` (old enum) vs default expression type = `"OrderStatus_next"` at statement 3.

### 4.2 Why this manifests in the shadow database
- Prisma’s shadow database replays migrations from a clean state to validate/apply schema changes. A statement that fails on clean replay will fail in shadow even if a long-lived development database already has the migration recorded/applied through a different historical path.
- Therefore the reported **“column type mismatch in the shadow database”** is consistent with step 3 being invalid during replay.

### 4.3 Additional replay considerations (secondary)
- `ALTER TYPE ... ADD VALUE` behavior and transactional constraints can be sensitive in some PostgreSQL/Prisma replay contexts; not identified as the primary reported mismatch but should be validated in proposed fix review.
- The migration assumes backfilled values are representable in `OrderStatus_next`; data-dependent, but logically covered by prior UPDATEs for known legacy values.

### 4.4 Failure locus assessment (by environment class)
| Environment | Evidence | Assessment |
|---|---|---|
| **Shadow database** | User-reported error: column type mismatch in shadow DB | **Confirmed (reported).** Consistent with §4.1 replay failure. |
| **Development database (configured DIRECT_URL target)** | `migrate status`: 8 migrations found, DB schema up to date | **No active failure indicated by status.** Migration appears recorded/applied there; partial-apply not indicated by status, but row-level `_prisma_migrations` details (finished/rolled_back/logs/applied_steps) were not retrievable in emitted form this session. |
| **Production database** | No direct evidence in repo/session; credentials/environments not inspected | **Unknown / unverified.** Must be checked independently (read-only) before any action. |
| **Staging/other** | No evidence | **Unknown / unverified.** |

**Conclusion:** Failure is a **shadow-replay blocker** with a concrete SQL ordering/type defect in migration history; dev/prod may differ in applied state and must not be assumed identical.

---

## 5. Current migration history and DB state (observed)

- **Configured datasource (CLI):** PostgreSQL at pooler host reported by `migrate status` (database name reported as `postgres`, schema `public`). Exact connection string not recorded.
- **`prisma migrate status`:** `8 migrations found in prisma/migrations` — `Database schema is up to date!`
- **`_prisma_migrations` metadata query:** Executed read-only via `prisma db execute --file` successfully; **result set not displayed** by CLI in this run. Required follow-up: capture rows (migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs) in each environment using an approved read-only method that returns visible results.
- **Schema ↔ DB diff (configured DB → current schema):**
  - `notification`: DB missing FK on `orderId` (schema expects relation/FK behavior).
  - `orderMessage`: DB `senderId` **Required** with FK `ON DELETE CASCADE`; schema expects **Nullable** with `ON DELETE SET NULL`.
  - `supportMessage`: DB `senderId` **Required** with FK `ON DELETE CASCADE`; schema expects **Nullable** with `ON DELETE SET NULL`.
- **Interpretation:** Migration history appears complete for existing 8 migrations on the configured DB, but **current schema contains security-remediation changes not yet reflected in DB/migrations** (blocked by migration tooling due to historical replay issue).

---

## 6. New security-remediation schema changes and constraint impact

| Change | Schema intent | Current DB (diff-observed) | Existing-record reconciliation risk |
|---|---|---|---|
| `Notification.order` FK (`orderId` nullable, `onDelete: SetNull`) | Referential integrity to `order` while preserving notifications when order removed | FK not present | **Medium:** orphan `notification.orderId` values (pointing to missing orders) would block FK creation. Read-only orphan count check was executed but row output was not captured in-session — **must verify per environment**. If orphans exist, reconcile data (review-only plan: set offending `orderId` to NULL or restore valid references per business rules) before/with FK addition. |
| `OrderMessage.senderId` nullable + `onDelete: SetNull` | Preserve messages when sender user deleted | `senderId` NOT NULL, FK CASCADE | **Low structural risk to nullability change** if all rows currently satisfy NOT NULL (expected). **Data semantics:** future deletes behave differently (set-null vs cascade) — no existing-row rewrite implied, but app must handle null sender. Precondition: no existing rows should have null if column currently NOT NULL (enforced). |
| `SupportMessage.senderId` nullable + `onDelete: SetNull` | Preserve support messages when sender deleted | `senderId` NOT NULL, FK CASCADE | Same as `OrderMessage`: primarily behavioral/DDL change; verify sender integrity and app null-handling. |

**Recommended pre-apply read-only checks (per environment, no writes):**
- `notification`: count rows where `orderId IS NOT NULL` and no matching `order.id`.
- `orderMessage` / `supportMessage`: count rows where `senderId IS NOT NULL` and no matching `user.id` (sanity; should be zero under FK).
- Confirm no application assumption requires non-null `senderId` before making nullable.

---

## 7. Recommended recovery strategy (review-only; do not execute)

### 7.1 Constraints shaping the plan
Given: **no reset, no delete/edit migration history, no `db push`, no destructive SQL, no apply, no resolve**. This prevents the usual fixes (editing `20261102210000_simplify_order_statuses`, `migrate resolve`, or `db push`), so the strategy must prioritize **safe diagnosis completion, environment-specific verification, and formally approved exception/change-control** for any eventual remediation.

### 7.2 Proposed approach (by goal)

#### A. Unblock migration tooling without violating “no history edit” (requires governance decision)
1. **Acknowledge immutability constraint:** Because the defective statement is inside an already-committed migration file, **shadow replay cannot be made correct without changing that historical SQL**. Under current constraints, `prisma migrate dev` / workflows that require shadow replay remain blocked.
2. **Controlled exception path (recommended for engineering approval):** In a dedicated change request, seek explicit approval to perform the *minimal* history correction (see §8.1) in a non-production branch/workflow context, validate against a disposable shadow DB only, then proceed with normal migration generation for security changes. *This is outside the allowed actions of this task but is the technically direct fix.*
3. **If history edit remains forbidden:** Accept that Prisma Migrate shadow-based generation is unavailable for this repo state; any forward path must be designed as **manually authored, review-gated SQL migrations/scripts** applied through approved operational procedures per environment (still subject to “do not apply” in this task). Documented below for review only.

#### B. Environment-specific verification (read-only, before any future action)
1. **Development (DIRECT_URL/CLI DB):**
   - Capture `_prisma_migrations` row for `20261102210000_simplify_order_statuses` (finished_at, rolled_back_at, applied_steps_count, logs).
   - Confirm actual `order.status` enum/type, `AssignmentStatus` values, and `orderBoosterAssignment_active_order_check` definition match intended end-state.
   - Run orphan/integrity pre-checks for security changes.
2. **Staging:**
   - Repeat B1 on staging datasource; do not assume parity with dev.
   - Validate shadow behavior in staging CI/tooling only if permitted by policy.
3. **Production:**
   - Read-only inspection only: migration record, enum/constraint state, data compatibility (legacy status values absent, assignment statuses valid), and security-change pre-checks.
   - **No direct changes** without approved runbook, backup/rollback window, and monitoring.

#### C. Applying pending security-remediation changes (future, reviewed)
- Prefer a **new forward migration** (after tooling is unblocked) that: adds `notification.orderId` FK (`ON DELETE SET NULL`), alters `orderMessage.senderId`/`supportMessage.senderId` to nullable and replaces FKs with `ON DELETE SET NULL`.
- Precondition: resolve notification/order orphans if any; deploy app code that tolerates nullable senders (already implied by schema).
- If shadow replay remains blocked and history cannot change, prepare **DBA-reviewed raw SQL** equivalent to that forward migration for controlled execution outside `migrate dev` (operational process decision).

---

## 8. Proposed SQL/migration changes for review (NOT to execute now)

### 8.1 Minimal correction to unblock shadow replay (would require history-edit exception)
**File:** `prisma/migrations/20261102210000_simplify_order_statuses/migration.sql`  
**Issue:** Default set to `OrderStatus_next` before column type conversion.

**Current (problematic order):**
```sql
CREATE TYPE "OrderStatus_next" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "order" ALTER COLUMN status SET DEFAULT 'PENDING'::"OrderStatus_next";
ALTER TABLE "order" ALTER COLUMN status TYPE "OrderStatus_next" USING status::text::"OrderStatus_next";
```

**Proposed corrected order (review):**
```sql
CREATE TYPE "OrderStatus_next" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- Convert column type first, then set default in the new type
ALTER TABLE "order" ALTER COLUMN status TYPE "OrderStatus_next" USING status::text::"OrderStatus_next";
ALTER TABLE "order" ALTER COLUMN status SET DEFAULT 'PENDING'::"OrderStatus_next";
```

**Notes:** Keep backfill UPDATEs, DROP/RENAME, `AssignmentStatus` `ADD VALUE 'PAUSED'`, and constraint refresh as-is unless separately validated. Any edit to applied migration history carries checksum/drift risk and must follow Prisma/team governance.

### 8.2 Forward migration for pending security changes (new migration; review-only draft)
*To be generated/applied only after replay/tooling path is healthy and pre-checks pass.*

```sql
-- Draft (review): align DB with current schema security changes

-- Notification: add FK if not present (ensure no orphan orderId values first)
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- OrderMessage: make sender nullable and switch FK to SET NULL
ALTER TABLE "orderMessage" DROP CONSTRAINT IF EXISTS "orderMessage_senderId_fkey";
ALTER TABLE "orderMessage" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "orderMessage"
  ADD CONSTRAINT "orderMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- SupportMessage: make sender nullable and switch FK to SET NULL
ALTER TABLE "supportMessage" DROP CONSTRAINT IF EXISTS "supportMessage_senderId_fkey";
ALTER TABLE "supportMessage" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "supportMessage"
  ADD CONSTRAINT "supportMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

**Precondition SQL checks (read-only):**
```sql
-- Orphan notifications (must be 0 or reconciled before FK add)
SELECT COUNT(*) FROM "notification" n
LEFT JOIN "order" o ON o.id = n."orderId"
WHERE n."orderId" IS NOT NULL AND o.id IS NULL;

-- Sender integrity sanity checks
SELECT COUNT(*) FROM "orderMessage" m LEFT JOIN "user" u ON u.id = m."senderId" WHERE m."senderId" IS NOT NULL AND u.id IS NULL;
SELECT COUNT(*) FROM "supportMessage" m LEFT JOIN "user" u ON u.id = m."senderId" WHERE m."senderId" IS NOT NULL AND u.id IS NULL;
```

---

## 9. Risks and rollback strategy

| Risk | Impact | Mitigation | Rollback (high-level, if future change applied) |
|---|---|---|---|
| Editing applied migration history (§8.1) | Migration checksum/history drift across environments; deploy/apply failures | Treat as governance exception; synchronize all environments; document exact change | Restore original file from VCS; re-baseline environment records only via approved DBA/Prisma procedure (not performed here) |
| Enum/type migration on `order.status` (historical) | Data cast failure if unexpected legacy values exist | Verify distinct `status` values and enum labels per env before any intervention | Restore from verified backup/snapshot; reverse enum migration is non-trivial (requires rebuild/type swap) |
| Adding `notification.orderId` FK | FK creation fails on orphan refs; write failures until app/data aligned | Run orphan pre-check; reconcile data plan first | `ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "notification_orderId_fkey";` (review before use) |
| Making senderId nullable / `SET NULL` FKs | App paths may assume non-null sender; behavioral change on user delete | Audit/readiness of UI/API for null sender; test in staging | Recreate NOT NULL + CASCADE only if safe and no nulls introduced: `UPDATE ... SET senderId = ...` not possible without valid user; prefer forward fix in app/data — rollback may require restore from backup |
| Environment drift (dev/staging/prod/shadow) | Fix works in one env but not others | Per-environment read-only verification and runbooks | Environment-specific restore points/backups |
| Partial/manual interventions outside Prisma Migrate | Future `migrate status/dev` inconsistency | Single approved operator path, documented SQL, post-change verification | Backup restore; reconcile `_prisma_migrations` only under explicit approved procedure |

**General rollback principle:** For any future DDL/DML recovery, take verified backups/snapshots and define a tested restore procedure per environment **before** execution. No rollback action executed in this investigation.

---

## 10. Environment-specific instructions (separate)

### 10.1 Development (local/team dev DB)
1. **Inspect (read-only):** confirm `_prisma_migrations` entry for `20261102210000_simplify_order_statuses` (finished/rolled_back/logs/applied_steps), current `OrderStatus`/`AssignmentStatus`/check constraint, and schema-vs-DB drift for notification/messages.
2. **Identify blocker:** if using `prisma migrate dev`, expect shadow replay to fail at simplify migration due to §4.1 unless history is corrected under approved exception.
3. **Plan:** if exception approved, minimally fix migration ordering (§8.1), validate on disposable shadow DB, then create/apply a new migration for §8.2 after pre-checks. If exception not approved, escalate for a DBA-reviewed forward SQL path; do **not** use `db push`.
4. **Safety:** preserve local data; no reset.

### 10.2 Staging
1. **Inspect (read-only):** full migration metadata, enum/constraint/object parity with intended state, orphan/integrity checks for pending FKs/nullability.
2. **Rehearse:** validate proposed forward SQL (§8.2) and any governance-approved history fix in an isolated clone/staging-shadow context first (where policy allows shadow DB creation).
3. **Gate:** require sign-off on data reconciliation (notification orphans), app compatibility for nullable senders, and rollback snapshot.

### 10.3 Production
1. **Inspect only (read-only):** confirm whether `20261102210000_simplify_order_statuses` is applied, clean, or failed; capture logs; verify order/assignment data cannot violate intended constraints.
2. **Do not apply ad-hoc fixes.** Prepare a maintenance runbook: pre-checks, approved SQL (from reviewed migration), backup/restore point, execution window, monitoring, and post-verification queries.
3. **Decision point:** if production never applied the failing migration, the defective SQL must be corrected in the delivery artifact before first application (governance-controlled). If already applied successfully, production risk centers on **pending security-remediation migration** and shadow/tooling drift, not re-running the historical simplify migration.
4. **Post-change verification (future):** confirm FKs/nullability/constraints, app behavior, and `migrate status` consistency.

---

## 11. Open items / evidence gaps
- **`_prisma_migrations` row details not captured in emitted output** during this session despite successful execution; retrieve visible results per environment (read-only).
- **Production/staging actual states unknown** (no access/evidence).
- **Shadow DB not directly inspectable** here; conclusion based on reported error + static SQL analysis.
- **Orphan/integrity counts not numerically captured** in-session; re-run read-only checks with result-returning method before any FK change.

---

## 12. Final status
Investigation completed in read-only mode. **No database reset, no migration/history edits/deletes, no `db push`, no destructive SQL, no migration apply, and no resolve actions were performed.** Recovery requires environment-specific verification and an approved remediation path that addresses the shadow-replay defect and safely introduces the pending security schema changes.
