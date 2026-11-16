# Prisma Migration Final Decision

**Date:** 2026-11-10  
**Status:** READ-ONLY decision report (no migrations applied, no schema/data/history changed)  
**Inputs:** `docs/PRISMA-MIGRATION-RECOVERY-PLAN.md`, `docs/PRISMA-MIGRATION-VERIFICATION-RESULTS.md`, `prisma/migrations/20261102210000_simplify_order_statuses/migration.sql`, `prisma/schema.prisma`, inspected datasource (configured `DIRECT_URL`) evidence, targeted application code inspection.  
**Decision:** **NOT APPROVED — MORE EVIDENCE REQUIRED**

> This document approves or withholds approval for migration **design/readiness** only. It does **not** grant permission to execute database changes.

---

## 1. Executive conclusion

- The inspected database (configured datasource, PostgreSQL `postgres/public`) shows the **intended end-state** of `20261102210000_simplify_order_statuses`: `order.status` is `USER-DEFINED` `OrderStatus` (NOT NULL, default `'PENDING'::"OrderStatus"`), enum labels are `PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED`, `AssignmentStatus` includes `PAUSED`, and `orderBoosterAssignment_active_order_check` includes `PAUSED` for active assignments. Existing order/assignment row values are consistent with the simplified model (no legacy statuses). Data-integrity prechecks for pending security changes are clean (0 orphan notification `orderId` refs, 0 invalid sender refs).
- `_prisma_migrations` history for that migration is **anomalous**: two failed/rolled-back attempts followed by a finished row with `applied_steps_count=0` and empty logs. The latest stored checksum matches the current repo file (`c3fa9987...`), but an earlier stored checksum (`0632e325...`) with error `42804` proves the migration content changed over time. The finished `applied_steps_count=0` row **cannot be treated as prima facie trustworthy** without corroborating schema evidence and cross-environment verification.
- Current schema drift (pending P0 security remediation) remains unapplied in the inspected DB: missing `notification.orderId -> order(id)` FK (`ON DELETE SET NULL`) and `orderMessage.senderId` / `supportMessage.senderId` still `NOT NULL` with `ON DELETE CASCADE` instead of nullable with `ON DELETE SET NULL`.
- **Safest path for environments that already match the inspected end-state:** leave historical migration files/history untouched and implement the pending changes as a **new forward migration / DBA-reviewed forward DDL** (only after approval and verification). **Fresh installations and shadow replay remain at risk** because the current `20261102210000_simplify_order_statuses` SQL still sets default to `"OrderStatus_next"` before converting column type.
- Staging and production are **not inspected**; no claim of equivalence is made. Approval for execution is withheld pending required evidence and governance decisions.

---

## 2. Verified facts versus assumptions

| Category | Verified facts (evidence-backed) | Assumptions / unverified |
|---|---|---|
| Migration file | `prisma/migrations/20261102210000_simplify_order_statuses/migration.sql` sets default to `'PENDING'::"OrderStatus_next"` (line 13) before `ALTER COLUMN status TYPE "OrderStatus_next"` (line 14), creating enum-type mismatch on replay. Current file SHA-256: `c3fa9987...34dd`. | That this exact ordering is the sole cause of every reported shadow failure in all environments (other replay sensitivities may exist). |
| Checksums | Latest stored checksum for target migration in inspected DB matches current file (`c3fa9987...`). Historical stored checksum `0632e325...` differs and corresponds to failed `42804` attempt. | How/where the file was edited before final record (Git shows only initial add in `3a65f179`). |
| `_prisma_migrations` (inspected DB) | 11 rows total; target migration has 3 rows: (1) `0632e325`, finished null, rolled_back 2026-11-02T21:28:00.481Z, steps 0, `42804 default for column "status" cannot be cast automatically to type "OrderStatus_next"`; (2) `c3fa9987`, finished null, rolled_back 2026-11-02T21:31:21.450Z, steps 0, `42710 type "OrderStatus_next" already exists`; (3) `c3fa9987`, finished 2026-11-02T21:32:40.715Z, rolled_back null, steps 0, empty logs. `migrate status`: 8 migrations found, DB up to date. | That no manual DB intervention occurred outside recorded metadata. |
| Actual DB schema (inspected) | `order.status`: `USER-DEFINED`, `OrderStatus`, NOT NULL, default `'PENDING'::"OrderStatus"`. `OrderStatus` labels `PENDING,IN_PROGRESS,PAUSED,COMPLETED,CANCELLED`. `AssignmentStatus` includes `PAUSED`. Check `orderBoosterAssignment_active_order_check` includes `PAUSED` in active branch. `notification.orderId` nullable text with only `notification_userId_fkey` (CASCADE to user); no FK to order. `orderMessage.senderId`/`supportMessage.senderId` NOT NULL with sender FKs `ON DELETE CASCADE`. | Full parity of all non-inspected tables/indexes/constraints with schema. |
| Data integrity (inspected) | Notification orphan `orderId`: **0**. OrderMessage invalid sender refs: **0**. SupportMessage invalid sender refs: **0**. Order statuses: COMPLETED=1, IN_PROGRESS=2, PENDING=5. Assignment statuses: COMPLETED=3, DECLINED=1, IN_PROGRESS=2, RELEASED=1. | Future data states; staging/prod counts. |
| Pending remediation design | Schema expects `Notification.order` FK `onDelete: SetNull`, and `OrderMessage.senderId` / `SupportMessage.senderId` nullable with `onDelete: SetNull`. | That application behavior is fully safe for null senders without changes (see §8). |
| Other environments | None inspected. | Development (other instances), staging, production, shadow DB state/history. |

---

## 3. Migration history timeline (`20261102210000_simplify_order_statuses`, inspected DB)

| # | started_at (UTC) | finished_at | rolled_back_at | checksum | applied_steps_count | logs / DB evidence | Meaning (evidence-based) |
|---|---|---|---|---|---:|---|---|
| 1 | 2026-11-02T21:26:58.047Z | null | 2026-11-02T21:28:00.481Z | `0632e325...` | 0 | `42804: default for column "status" cannot be cast automatically to type "OrderStatus_next"` | **Failed and rolled back.** Consistent with the defective ordering present in that historical file version (default set to `OrderStatus_next` while column still `OrderStatus`). No net applied end-state can be assumed from this row. |
| 2 | 2026-11-02T21:28:14.598Z | null | 2026-11-02T21:31:21.450Z | `c3fa9987...` | 0 | `42710: type "OrderStatus_next" already exists` | **Failed and rolled back (metadata), but indicates prior partial side effects possible before failure.** After attempt #1 rollback, `OrderStatus_next` should not normally persist in a clean transactional rollback; this error strongly suggests leftover objects/state from a non-atomic/partially applied prior attempt or manual residue. History alone is insufficient to prove full rollback of schema objects. |
| 3 | 2026-11-02T21:32:40.715Z | 2026-11-02T21:32:40.715Z | null | `c3fa9987...` | 0 | empty | **Recorded as finished, not rolled back, but anomalous (`applied_steps_count=0`, zero duration signature).** Current DB objects match the migration’s intended outcome, so the **effective schema result is present**; however the record is not normal evidence of a standard Prisma apply. It may reflect manual reconciliation/marking or out-of-band execution — cause is **unknown**. |

**Assessment of latest finished record:** It is **partially corroborated** (schema end-state matches intent) but **not fully trustworthy on its own** due to `applied_steps_count=0`, empty logs, and preceding failed attempts. Trust for operational decisions must come from **actual schema/data verification per environment**, not this row alone.

---

## 4. Current database schema versus Prisma schema

| Area | Prisma schema (current) | Inspected DB (actual) | Status |
|---|---|---|---|
| `Order.status` type/default | `OrderStatus @default(PENDING)` with enum `PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED` | `USER-DEFINED OrderStatus`, NOT NULL, default `'PENDING'::"OrderStatus"` | **Matches intended simplify result** |
| `OrderStatus` enum labels | `PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED` | Same labels | **Match** |
| `AssignmentStatus` enum | Includes `PAUSED` | Includes `PAUSED` | **Match** |
| `orderBoosterAssignment_active_order_check` | Active statuses include `ASSIGNED, ACCEPTED, IN_PROGRESS, PAUSED` when `activeOrderId` set | Check definition includes `PAUSED` in active branch | **Match** |
| `Notification.orderId` relation | `order Order? @relation(..., onDelete: SetNull)` | Column nullable; **no FK to `order`** (only user FK) | **Drift (pending)** |
| `OrderMessage.senderId` | `String?` + relation `onDelete: SetNull` | `text` NOT NULL, FK `senderId -> user(id) ON DELETE CASCADE` | **Drift (pending)** |
| `SupportMessage.senderId` | `String?` + relation `onDelete: SetNull` | `text` NOT NULL, FK `senderId -> user(id) ON DELETE CASCADE` | **Drift (pending)** |

---

## 5. Strategy evaluation

### Options considered

| Option | Description | Existing databases (already at correct simplify end-state) | Existing databases (failed/partial/divergent simplify state) | Fresh installations / clean shadow replay | Staging | Production |
|---|---|---|---|---|---|---|
| **A. Leave historical migration untouched + new forward migration/SQL** | Keep `20261102210000_simplify_order_statuses` file/history as-is; deliver pending security changes as a new forward migration or DBA-reviewed SQL artifact. | **Safest for schema state** if verified to match intent (as inspected). Avoids checksum/history churn. Does **not** fix shadow replay of historical chain. | **Insufficient alone** until simplify state is repaired/reconciled per-environment. | **Unsafe/blocked for standard Prisma shadow-based flows** because historical migration remains replay-problematic. | Safe only after staging is verified to match same preconditions and with approved deployment procedure. | Same as staging; higher governance/rollback bar. |
| **B. Correct historical migration SQL for future clean installations** | Modify `20261102210000_simplify_order_statuses` (e.g. swap type/default order) so clean replay succeeds. | **Risky without governance:** creates checksum divergence vs recorded history in environments where `c3fa9987...` is recorded; may break `migrate deploy/status` expectations. Unnecessary where end-state already correct. | May help only as part of a controlled, environment-specific remediation; not a standalone fix. | **Beneficial for clean replay/fresh DBs** if delivered under a controlled strategy (separate artifact/branching policy or reconciled history). | Requires full history/schema verification and approved reconciliation plan. | High risk; only under strict change control. |
| **C. Approved Prisma migration-history reconciliation procedure** (`migrate resolve` / mark-applied/rolled-back, etc.) | Align `_prisma_migrations` records with reality using Prisma-supported reconciliation. | Potentially useful to normalize anomalous records **only** when actual schema is conclusively verified and procedure is approved. Does not change schema objects. | May be required for failed/partial states, but can be dangerous if misapplied. | No direct effect on SQL correctness; fresh installs still need valid migration chain. | Allowed only with per-environment evidence and approval. | Allowed only with per-environment evidence, backups, and approval. |
| **D. DBA-reviewed SQL deployment procedure** | Apply reviewed forward SQL manually (outside `prisma migrate dev`), with runbook, backups, and post-checks. | **Appropriate/controlled** for pending security changes when Prisma tooling is constrained; must manage migration-history bookkeeping separately if required by org policy. | Can be used for targeted repair, but requires bespoke, verified scripts and extreme caution. | Not a substitute for a healthy migration chain for developer bootstrap; can provision schema but diverges from standard workflow. | Suitable for controlled rollout with rehearsal and verification. | Suitable for controlled rollout with strict change management. |

### Risk summary by option
- **A:** Low schema risk for verified-matching DBs; **high workflow risk** (shadow/dev generation) persists; cross-env drift risk.
- **B:** Fixes replay logic but introduces **history integrity/checksum risk**; unsafe as blind in-place edit.
- **C:** Resolves metadata symptoms, **not root technical defects**; misuse can desynchronize truth.
- **D:** Operationally flexible and auditable, but **bypasses Prisma’s standard safety rails**; requires disciplined verification and possible follow-up history alignment.

---

## 6. Recommended strategy and justification

### Recommendation (design-level)
1. **Classify environments first (mandatory):** for each DB (dev instances, staging, production), capture read-only evidence: `_prisma_migrations` rows for the target migration, `OrderStatus`/`AssignmentStatus` labels, `order.status` type/default, assignment check constraint, presence/absence of pending FKs/nullability, and integrity counts (orphans, legacy status values).
2. **For environments whose actual state matches the inspected “simplify complete + pending security drift only” profile:** adopt **Option A + D** — keep historical migration files/history untouched; implement pending security remediation as a **new forward, idempotent-aware, DBA-reviewed DDL package** (or equivalent reviewed migration artifact) applied via approved operational procedure. Do **not** use `db push`, `migrate resolve`, reset, or in-place history edits as part of this path.
3. **For environments with failed/partial/divergent simplify state:** do **not** reuse the same forward-only package blindly. Require a **bespoke, evidence-based repair plan** (may combine targeted SQL, and only if approved, Option C reconciliation) validated on a restored clone/disposable environment.
4. **For fresh installations / CI shadow generation:** address separately under governance — either provide a controlled corrected bootstrap artifact or a dedicated environment provisioning path. This is **not solved** by applying a forward-only fix to existing production-like DBs.
5. **Application readiness before/with schema rollout:** remediate nullable-sender handling in UI code identified in §8 (minimum) and re-verify related flows.

### Justification
- The inspected DB already reflects the simplify migration’s intended schema outcome; changing history would add risk without schema benefit there.
- Pending changes are narrow, additive/relaxing in data shape (nullable senders, added FK with 0 observed orphans in inspected DB) and can be designed as forward DDL.
- Anomalous migration metadata and unverified environments prevent a blanket safe execution claim; therefore design may proceed conditionally, but execution readiness requires more evidence.

---

## 7. Separate instructions for existing and fresh databases

### 7.1 Existing databases
- **Precondition (per DB):** read-only verification confirms simplify end-state matches expected objects/constraints and pending drift matches §4; integrity prechecks pass (especially notification `orderId` orphans = 0).
- **Action design:** apply only forward security-remediation DDL (§9) in a transactionally appropriate, reviewed manner with backup/restore point. Re-run prechecks immediately before execution.
- **Do not:** edit `20261102210000_simplify_order_statuses`, run `prisma migrate dev`, `db push`, reset, or `migrate resolve` without explicit approved exception and per-environment evidence.
- **If history/tooling alignment is later required:** handle via separately approved Option C procedure after proving schema truth.

### 7.2 Fresh databases / clean bootstrap / shadow replay
- **Current state:** clean replay of committed migrations includes `20261102210000_simplify_order_statuses` with default-before-type ordering; **standard shadow-based generation is expected to remain fragile or fail** until chain is made replay-safe under an approved strategy.
- **Design guidance:** establish an approved bootstrap path (e.g. governance-controlled corrected baseline artifact, or documented provisioning workflow) that produces the same final schema as verified production-like environments **without destructive shortcuts**. Any change to historical migration artifacts requires checksum/history reconciliation policy across all environments.
- **Constraint:** no such corrective action is taken in this task.

---

## 8. Pending security-remediation schema changes and application impact

### 8.1 Database changes (pending)
1. **`notification.orderId`**: add FK `notification(orderId) -> order(id)` `ON DELETE SET NULL` `ON UPDATE CASCADE` (column already nullable in inspected DB).
2. **`orderMessage.senderId`**: drop/recreate sender FK as `ON DELETE SET NULL`, alter column to nullable.
3. **`supportMessage.senderId`**: drop/recreate sender FK as `ON DELETE SET NULL`, alter column to nullable.

### 8.2 Data compatibility (inspected DB)
- Notification orphan `orderId` refs: **0** (FK add precondition satisfied in inspected DB; must be rechecked elsewhere).
- Invalid sender refs for order/support messages: **0**.
- Existing sender IDs non-null today; nullability change is structurally compatible but enables future `NULL` on user deletion.

### 8.3 Application code assumptions (sender IDs / sender objects)
| Location | Observation | Risk if sender becomes null / `senderId` null post-migration |
|---|---|---|
| `components/chat/OrderChat.tsx` | `Message.senderId` typed `string`; UI uses `message.sender?.image`, `message.sender?.name ?? "Unknown"` and `isOwn = message.senderId === currentUserId`. | **Mostly tolerant** for display; ownership check remains correct for existing rows but must consider null `senderId` semantics if ever possible (future deleted users). |
| `components/support/SupportTicketDetail.tsx` | `Message` interface declares `sender: { id; name; image }` (non-null). Renders `{!message.isAdminReply && message.sender.image && ...}`, `message.sender.name ?? "Unknown"`, and admin avatar `message.sender.image` without null guards. | **Likely runtime break (TypeError)** when a sender relation is nullified by `SET NULL` behavior and API returns `sender: null`. Requires code hardening before/with rollout. |
| `lib/chat/service.ts`, `lib/support/service.ts` | Select/include `sender { id,name,image }`; create with provided `senderId`. | API/service shape must explicitly allow nullable sender for historical/system-deleted cases. |
| Other UI/API consumers | Not exhaustively audited. | **Unknown residual assumptions**; targeted audit required before apply. |

**Conclusion:** Schema change is directionally correct for security/data-retention goals, but **application null-safety is not fully verified**; `SupportTicketDetail` shows a concrete assumption risk.

---

## 9. Forward migration design (review-only, not to execute)

### 9.1 Pre-execution checks (read-only, per environment)
```sql
-- Must be 0 (or reconciled under approved plan) before adding notification.orderId FK
SELECT COUNT(*)::int AS notification_orphan_order_refs
FROM "notification" n
LEFT JOIN "order" o ON o.id = n."orderId"
WHERE n."orderId" IS NOT NULL AND o.id IS NULL;

-- Sanity (expected 0 under current FKs)
SELECT COUNT(*)::int AS order_message_invalid_senders
FROM "orderMessage" m LEFT JOIN "user" u ON u.id = m."senderId"
WHERE m."senderId" IS NOT NULL AND u.id IS NULL;

SELECT COUNT(*)::int AS support_message_invalid_senders
FROM "supportMessage" m LEFT JOIN "user" u ON u.id = m."senderId"
WHERE m."senderId" IS NOT NULL AND u.id IS NULL;

-- Confirm pending drift still present
SELECT conname FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
WHERE t.relname='notification' AND c.contype='f';

SELECT is_nullable FROM information_schema.columns
WHERE table_name='orderMessage' AND column_name='senderId';

SELECT is_nullable FROM information_schema.columns
WHERE table_name='supportMessage' AND column_name='senderId';
```

### 9.2 Proposed forward DDL (single reviewed change set)
```sql
-- 1) Notification.orderId FK (nullable, preserve notification on order delete)
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) OrderMessage.senderId -> nullable, SET NULL on user delete
ALTER TABLE "orderMessage" DROP CONSTRAINT IF EXISTS "orderMessage_senderId_fkey";
ALTER TABLE "orderMessage" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "orderMessage"
  ADD CONSTRAINT "orderMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) SupportMessage.senderId -> nullable, SET NULL on user delete
ALTER TABLE "supportMessage" DROP CONSTRAINT IF EXISTS "supportMessage_senderId_fkey";
ALTER TABLE "supportMessage" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "supportMessage"
  ADD CONSTRAINT "supportMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

**Design notes:** execute under approved DBA/runbook controls (backup first, maintenance window as needed, transactional behavior understood). If delivered as a Prisma migration file, generate/place it only through an approved workflow that accounts for shadow/history constraints; this report does not authorize creation or application.

---

## 10. Rollback and verification plan

### 10.1 Post-apply verification (if ever executed under approval)
- **Schema:** confirm `notification_orderId_fkey` exists with `ON DELETE SET NULL`; `orderMessage.senderId`/`supportMessage.senderId` are nullable and their sender FKs are `ON DELETE SET NULL`.
- **Data:** re-run orphan/integrity checks; spot-check notification/order joins and message rendering for null-sender cases.
- **App:** verify order chat/support ticket views, notification navigation, and any sender-dependent logic; monitor error rates.
- **Tooling:** confirm migration history/status reporting is consistent with the chosen deployment method (Prisma-tracked migration vs manual SQL) per approved process.

### 10.2 Rollback strategy (design)
- **Primary rollback:** restore from verified pre-change backup/snapshot (preferred for production).
- **Targeted DDL rollback (only if safe and approved):**
  - Drop `notification_orderId_fkey`.
  - For messages, reverting to `NOT NULL` + `ON DELETE CASCADE` is **only possible if no NULL `senderId` values were introduced** and business semantics permit; otherwise do **not** force revert—restore from backup and/or ship forward app/data fixes.
- **Migration-history alignment:** if any history reconciliation was performed under approval, reverse it only via an equally approved, evidence-based procedure.

---

## 11. Staging and production verification requirements

Before any execution approval in staging/production, obtain and record (read-only) for **each** environment:
1. Full `_prisma_migrations` rows for all migrations, with special attention to every attempt of `20261102210000_simplify_order_statuses` (checksum, started/finished/rolled_back, applied_steps_count, logs).
2. Actual `order.status` column type/default, `OrderStatus` and `AssignmentStatus` enum labels, and `orderBoosterAssignment_active_order_check` definition.
3. Presence/definition of `notification.orderId` FK, and `orderMessage.senderId` / `supportMessage.senderId` nullability + FK delete rules.
4. Counts: notification order orphans, order/support message invalid sender refs, distinct order statuses, distinct assignment statuses.
5. Confirmation of deployment/tooling path (Prisma migrate deploy, manual SQL, CI shadow usage) and environment parity (instances/branches/replicas).
6. Backup/restore capability, maintenance window, and rollback owner/runbook sign-off.

**No staging/production environment is verified in this investigation.**

---

## 12. Exact commands for future execution (DO NOT EXECUTE)

> Commands below are for **future, explicitly approved** use only. They may be destructive to state/history if misused. Do not run during read-only investigation.

```bash
# --- Read-only prechecks (approved) ---
npx prisma migrate status --config prisma.config.ts
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --config prisma.config.ts

# --- Generate/apply via Prisma (ONLY if shadow/history strategy is approved and safe) ---
# npx prisma migrate dev --name add_security_relation_fixes --create-only --config prisma.config.ts
# npx prisma migrate deploy --config prisma.config.ts

# --- Prisma history reconciliation (ONLY under approved exception, per-environment evidence) ---
# npx prisma migrate resolve --applied "20261102210000_simplify_order_statuses" --config prisma.config.ts
# npx prisma migrate resolve --rolled-back "20261102210000_simplify_order_statuses" --config prisma.config.ts

# --- Direct SQL execution (ONLY via approved DBA procedure; prefer reviewed script/file) ---
# psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f path/to/reviewed_forward_security_fix.sql

# --- Explicitly prohibited shortcuts (do not use) ---
# npx prisma db push
# npx prisma migrate reset
```

---

## 13. Final decision

**NOT APPROVED — MORE EVIDENCE REQUIRED**

**Rationale:** Migration **design** for the pending security-remediation forward changes can be specified from inspected evidence, but safe approval for cross-environment application is blocked by (1) unverified staging/production/other dev databases, (2) anomalous target-migration history (`applied_steps_count=0`, prior failed/rolled-back attempts, historical checksum change), (3) unresolved fresh-install/shadow-replay risk in the historical migration chain, and (4) incomplete confirmation of application null-safety for nullable message senders. Additional per-environment evidence and governance decisions are required before execution.
