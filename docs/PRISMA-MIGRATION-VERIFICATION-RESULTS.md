# Prisma Migration Verification Results

**Date:** 2026-11-10  
**Scope:** Read-only investigation only (no DB writes, no schema/migration/history edits, no resolve, no `db push`, no reset). No credentials exposed.  
**Primary target:** `20261102210000_simplify_order_statuses`  
**Inputs reviewed:** `docs/PRISMA-MIGRATION-RECOVERY-PLAN.md`, `prisma/migrations/20261102210000_simplify_order_statuses/migration.sql`, `prisma/schema.prisma`, configured datasource read-only inspection via `DIRECT_URL` (project env), Git history.

---

## 1. Checksum comparison

| Item | Value |
|---|---|
| Current migration file | `prisma/migrations/20261102210000_simplify_order_statuses/migration.sql` |
| Current file checksum (SHA-256, hex) | `c3fa99879bb935db7b4bbe3610b4623d8b9ed2ce479300e93dc8c6841beb34dd` |
| Current file checksum (SHA-256, base64) | `w/qZh5u5Ndt7S742ELRiPYue0s5HkwDpPcjGhBvrNN0=` |
| Stored checksum in `_prisma_migrations` (latest row for this migration) | `c3fa99879bb935db7b4bbe3610b4623d8b9ed2ce479300e93dc8c6841beb34dd` |
| **Match (current file vs latest stored)** | **YES** |

### Historical `_prisma_migrations` rows for this migration (same migration_name)
| started_at (UTC) | checksum | finished_at | rolled_back_at | applied_steps_count | logs summary |
|---|---|---|---|---|---:|---|
| 2026-11-02T21:26:58.047Z | `0632e325c715afa2df229c542087a03d3947564336f9f9024162d684463c74f8` | `null` | 2026-11-02T21:28:00.481Z | 0 | Failed: `ERROR 42804 default for column "status" cannot be cast automatically to type "OrderStatus_next"` |
| 2026-11-02T21:28:14.598Z | `c3fa99879bb935db7b4bbe3610b4623d8b9ed2ce479300e93dc8c6841beb34dd` | `null` | 2026-11-02T21:31:21.450Z | 0 | Failed: `ERROR 42710 type "OrderStatus_next" already exists` |
| 2026-11-02T21:32:40.715Z | `c3fa99879bb935db7b4bbe3610b4623d8b9ed2ce479300e93dc8c6841beb34dd` | 2026-11-02T21:32:40.715Z | `null` | 0 | empty |

### Implications
- The migration file **was modified at least once** in practice: an earlier attempt is recorded with checksum `0632e325...` and a different failure (`42804`, matching the reported/default-cast-before-type issue), while the current file and later attempts use `c3fa9987...`.
- The **current file matches the checksum of the latest recorded attempt(s)** (`c3fa9987...`). There is **no current checksum mismatch** between repo file and the most recent DB history entry for this migration.
- The successful/latest row records `finished_at` set, `rolled_back_at` null, but **`applied_steps_count = 0`** and empty logs — an atypical marker that requires caution when interpreting “applied” state (see §2, §9).
- Because the current file matches the latest stored checksum, `prisma migrate` checksum-drift detection is **not** the immediate blocker from this comparison alone; however, historical checksum changes across attempts confirm the migration content changed over time (see §6).

---

## 2. Migration state by environment

### Accessible environment inspected (configured datasource / DIRECT_URL)
- **Database:** PostgreSQL `postgres`, schema `public` (as reported by read-only query; host/credentials not recorded).
- **`prisma migrate status`:** `8 migrations found in prisma/migrations` — **Database schema is up to date!**

| migration_name | checksum (stored) | started_at (UTC) | finished_at (UTC) | rolled_back_at (UTC) | applied_steps_count | state interpretation |
|---|---|---|---|---|---|---|
| 20261101000000_add_auth_models | `7eddab83...` | 2026-11-01T17:45:36.014Z | `null` | 2026-11-01T17:46:55.620Z | 0 | Failed then rolled back (`UserRole` missing at that point) |
| 20261101000000_add_auth_models | `7047023d...` | 2026-11-01T17:47:30.180Z | 2026-11-01T17:47:30.546Z | `null` | 1 | Applied (recorded) |
| 20261101210148_fix_account_expires_at | `7ef61834...` | 2026-11-01T21:02:10.286Z | 2026-11-01T21:02:11.621Z | `null` | 1 | Applied |
| 20261102131302_add_rbac_profiles | `9297ab1b...` | 2026-11-02T13:13:02.455Z | 2026-11-02T13:13:02.974Z | `null` | 1 | Applied |
| 20261102151147_phase2a_orders | `5a3ab9ae...` | 2026-11-02T15:12:24.845Z | 2026-11-02T15:12:25.670Z | `null` | 1 | Applied |
| 20261102153141_phase2b_assignment | `867a2612...` | 2026-11-02T15:32:25.878Z | 2026-11-02T15:32:26.957Z | `null` | 1 | Applied |
| 20261102153232_phase2b_assignment | `18fb8f6f...` | 2026-11-02T15:33:23.058Z | 2026-11-02T15:33:23.295Z | `null` | 1 | Applied |
| 20261102201109_add_booster_application_workflow | `858eb5bb...` | 2026-11-02T20:11:09.925Z | 2026-11-02T20:11:10.353Z | `null` | 1 | Applied |
| 20261102210000_simplify_order_statuses | `0632e325...` | 2026-11-02T21:26:58.047Z | `null` | 2026-11-02T21:28:00.481Z | 0 | **Failed, rolled back** (42804 cast/default mismatch) |
| 20261102210000_simplify_order_statuses | `c3fa9987...` | 2026-11-02T21:28:14.598Z | `null` | 2026-11-02T21:31:21.450Z | 0 | **Failed, rolled back** (42710 `OrderStatus_next` already exists — consistent with leftover type from prior partial attempt) |
| 20261102210000_simplify_order_statuses | `c3fa9987...` | 2026-11-02T21:32:40.715Z | 2026-11-02T21:32:40.715Z | `null` | 0 | **Recorded finished, not rolled back, but `applied_steps_count=0`**; DB objects show intended end-state (see §3) — likely manually reconciled/marked or applied outside normal step accounting; **treat as historically abnormal and verify in all envs** |

**Target migration conclusion (this env):** Not currently recorded as failed/rolled-back in the latest row; recorded as finished with anomalies. Effective schema state for order/assignment simplification is present (see §3), but migration history contains failed/rolled-back attempts and a zero-step “finished” record.

### Development / Staging / Production (other environments)
| Environment | Access | Migration state |
|---|---|---|
| Development (other than configured DIRECT_URL target) | **Not accessible / not configured in-session** | **Unknown** — must be verified independently with same read-only queries |
| Staging | **Not accessible** | **Unknown** |
| Production | **Not accessible** | **Unknown** |

**No environment may be assumed identical to the inspected datasource.**

---

## 3. Actual database schema (inspected environment)

### `order.status`
| Field | Actual DB value |
|---|---|
| data_type | `USER-DEFINED` |
| udt_name | `OrderStatus` |
| is_nullable | `NO` |
| column_default | `'PENDING'::"OrderStatus"` |

### Enum labels
| Enum | Actual labels (in order) |
|---|---|
| `OrderStatus` | `PENDING`, `IN_PROGRESS`, `PAUSED`, `COMPLETED`, `CANCELLED` |
| `AssignmentStatus` | `ASSIGNED`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `DECLINED`, `CANCELLED`, `RELEASED`, `PAUSED` |

### `orderBoosterAssignment` check constraints
| conname | definition |
|---|---|
| `orderBoosterAssignment_active_order_check` | `CHECK (((( "activeOrderId" IS NULL) AND (status = ANY (ARRAY['COMPLETED'::"AssignmentStatus", 'DECLINED'::"AssignmentStatus", 'CANCELLED'::"AssignmentStatus", 'RELEASED'::"AssignmentStatus"]))) OR (( "activeOrderId" IS NOT NULL) AND (status = ANY (ARRAY['ASSIGNED'::"AssignmentStatus", 'ACCEPTED'::"AssignmentStatus", 'IN_PROGRESS'::"AssignmentStatus", 'PAUSED'::"AssignmentStatus"])) AND ( "activeOrderId" = "orderId"))))` |

### `notification`
| Aspect | Actual |
|---|---|
| `orderId` column | `text`, nullable = `YES` |
| Foreign keys | `notification_userId_fkey`: `FOREIGN KEY ("userId") REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `orderId` FK to `order` | **Not present** |

### `orderMessage`
| Aspect | Actual |
|---|---|
| `senderId` column | `text`, nullable = `NO`, default = `null` |
| Foreign keys | `orderMessage_conversationId_fkey` → `orderConversation(id) ON UPDATE CASCADE ON DELETE CASCADE`; `orderMessage_senderId_fkey` → `user(id) ON UPDATE CASCADE ON DELETE CASCADE` |

### `supportMessage`
| Aspect | Actual |
|---|---|
| `senderId` column | `text`, nullable = `NO`, default = `null` |
| Foreign keys | `supportMessage_ticketId_fkey` → `supportTicket(id) ON UPDATE CASCADE ON DELETE CASCADE`; `supportMessage_senderId_fkey` → `user(id) ON UPDATE CASCADE ON DELETE CASCADE` |

---

## 4. Schema drift (actual DB vs current `prisma/schema.prisma`)

| Object | Current schema expects | Actual DB | Drift |
|---|---|---|---|
| `Order.status` / `OrderStatus` | `PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED` | Same labels/type/default intent present | **No drift** for simplify outcome |
| `AssignmentStatus` + active check | Includes `PAUSED` in active set | Includes `PAUSED` and matching check logic | **No drift** for simplify outcome |
| `Notification.orderId` FK | `orderId String?` with relation `onDelete: SetNull` to `Order` | Column nullable, **no FK to `order`** | **Drift: missing FK** (security-remediation pending) |
| `OrderMessage.senderId` | `String?` with relation `onDelete: SetNull` | `NOT NULL`, FK `ON DELETE CASCADE` | **Drift: nullability + delete rule** |
| `SupportMessage.senderId` | `String?` with relation `onDelete: SetNull` | `NOT NULL`, FK `ON DELETE CASCADE` | **Drift: nullability + delete rule** |
| Other models/enums not re-inspected exhaustively | — | — | **Not fully verified** beyond targeted scope |

**Summary:** The historical `simplify_order_statuses` structural intent is reflected in the inspected DB. Pending drift is limited to P0 security-remediation relation/constraint changes on notification and message sender FKs.

---

## 5. Data integrity results (visible numerical, inspected environment)

| Check | Query intent | Result (count) |
|---|---|---:|
| Notification orphan `orderId` refs | `notification.orderId IS NOT NULL` with no matching `order.id` | **0** |
| OrderMessage invalid sender refs | `orderMessage.senderId IS NOT NULL` with no matching `user.id` | **0** |
| SupportMessage invalid sender refs | `supportMessage.senderId IS NOT NULL` with no matching `user.id` | **0** |

### Existing `order.status` values
| status | count |
|---|---:|
| `COMPLETED` | 1 |
| `IN_PROGRESS` | 2 |
| `PENDING` | 5 |
| **Total** | **8** |

No legacy statuses (`QUEUED`, `PENDING_REVIEW`, `ASSIGNED`) present.

### Existing `orderBoosterAssignment.status` values
| status | count |
|---|---:|
| `COMPLETED` | 3 |
| `DECLINED` | 1 |
| `IN_PROGRESS` | 2 |
| `RELEASED` | 1 |
| **Total** | **7** |

No unexpected/legacy values observed; `PAUSED` not present in current rows but is a valid enum label/check target.

---

## 6. Whether the historical migration was modified after application

**Evidence indicates modification over time (yes), with an abnormal final record:**
- `_prisma_migrations` shows the **same migration name** recorded with **two different checksums**: `0632e325...` (failed, 42804) and `c3fa9987...` (later failed 42710, then finished with `applied_steps_count=0`). Current file matches `c3fa9987...`.
- **Git history:** only one commit found touching the file (`3a65f179`, 2026-11-03, “chore: prepare LegendsBoost for GitHub”, added as `A`). No subsequent tracked modifications shown. This does **not** prove pre-commit/local edits did not occur before the Git snapshot; DB history demonstrates content/checksum changed between attempts.
- **Interpretation:** The migration SQL was altered from the version that produced the `42804` failure to the current `c3fa9987...` version before the final finished record. The final “applied” representation in history is **not** a clean, single successful `prisma migrate` application with normal step accounting.

---

## 7. Safety/appropriateness of the proposed history correction

**Proposed correction (from recovery plan):** swap statements in `20261102210000_simplify_order_statuses` so column type is altered to `OrderStatus_next` before setting default to `'PENDING'::"OrderStatus_next"`.

| Consideration | Assessment |
|---|---|
| Technical correctness for shadow replay | **Appropriate in principle** — fixes the demonstrated `42804` ordering/type issue. |
| Current repo state vs DB history | Latest DB record already corresponds to checksum `c3fa9987...` and current file content; editing the file now would create a **new checksum mismatch** against recorded history and **does not align** with the already-finished (albeit anomalous) DB state for this environment. |
| Already-applied environments | In the inspected DB, `order`/`AssignmentStatus`/check constraint are already in intended end-state. Rewriting this historical migration is **unnecessary for this DB state** and **risky** for cross-environment consistency/checksum governance. |
| Environments that never applied it (or failed differently) | A corrected migration artifact may be needed for clean apply/shadow replay, but delivering it requires a controlled strategy (versioned replacement/new migration policy, environment-specific reconciliation) — not a blind in-place edit. |
| Constraints given (no migration/history edits) | **Not permissible** under current task constraints. |

**Conclusion:** The proposed history correction is **technically sound as a replay fix** but **not safe/appropriate as an in-place edit right now** without full environment reconciliation and governance approval, given the existing finished-but-anomalous history and current DB end-state in the inspected environment.

---

## 8. Whether a new forward migration can be generated safely

**For pending security-remediation drift (notification FK, `orderMessage.senderId`/`supportMessage.senderId` nullable + `ON DELETE SET NULL`):**

| Factor | Finding |
|---|---|
| Data preconditions (inspected env) | `notification` order orphans = **0**; message sender integrity orphans = **0**; existing sender columns contain no nulls (NOT NULL today) — **compatible** with proposed DDL. |
| Shadow/`migrate dev` viability | **Still blocked by historical migration replay/anomalous history risk**; Prisma shadow replay of the full migration chain remains the gating concern reported previously and cannot be declared safe without controlled validation. |
| `migrate diff` from configured DB → schema | Produces the expected forward changes (add notification order FK, alter sender columns/FKs) — **logically safe as SQL intent** for this DB state. |
| Safety to “generate safely” now | **Not safe to auto-generate/apply via standard `prisma migrate dev` under current conditions**. A **manually authored, DBA-reviewed forward migration/SQL script** (review-only draft exists in recovery plan) is the safer path **after** governance decision on history/tooling, provided it is applied only through approved procedures outside this task. |

**Recommendation on generation:** Do **not** run `prisma migrate dev` to generate/apply yet. Prepare/retain reviewed forward SQL for the three schema changes; generate a formal migration artifact only within an approved recovery workflow that accounts for shadow/history constraints.

---

## 9. Remaining unknowns

1. **Staging and production `_prisma_migrations` state** (including any failed/rolled-back/partial records for `20261102210000_simplify_order_statuses`).
2. **Other development databases/branches** that may have different migration checksums or partial states.
3. **How the latest row achieved `finished_at` with `applied_steps_count=0`** (manual `resolve`/mark-applied, direct SQL reconciliation, or tooling artifact) — not provable from read-only artifacts here.
4. **Whether `prisma migrate deploy/status/dev` behaves consistently in CI/CD or other environments** given anomalous history rows and prior checksum changes.
5. **Full schema parity** beyond inspected tables/constraints (other relations/indexes/defaults not exhaustively compared).
6. **Application/runtime compatibility** with nullable `senderId` across all code paths (schema already implies it; runtime not re-verified in this report).
7. **Shadow database behavior** in the exact failing environment reported earlier (not directly reproducible/inspected here).

---

## 10. Clear recommendation for the next approved action

1. **Do not execute recovery now.** Keep state unchanged.
2. **Complete cross-environment read-only verification (approved):** collect `_prisma_migrations` rows, enum/check/FK state, and the same integrity counts from **every** staging/production/dev database. Treat any divergence as a blocking decision point.
3. **Governance decision (approved change request required):**
   - **Preferred for inspected DB state:** treat `20261102210000_simplify_order_statuses` as effectively in-place for environments matching this end-state; **do not in-place edit history** there. Focus on an approved, manually reviewed **forward migration/SQL** for the 3 security-remediation changes (with pre-checks already passing here).
   - **For environments with clean replay required or failed/missing simplify state:** design an explicit remediation path (e.g. corrected artifact delivery, controlled history reconciliation, or environment-specific SQL) — do **not** blindly rewrite the committed migration without per-environment checksum/history alignment.
4. **Before any future apply (when approved):** take backups/snapshots, run pre-checks again (orphans/integrity), apply only the reviewed forward DDL in a maintenance window, then verify FKs/nullability/constraints and `migrate status`.
5. **Explicitly avoid** under current risk profile: `prisma migrate dev`, `db push`, `migrate resolve`, resets, or migration file/history edits.

**Overall status:** Evidence gaps for the **inspected datasource** are closed (checksum match to latest record, full migration metadata, schema/constraint state, and numerical integrity counts captured). The primary blocker is now **process/governance + multi-environment consistency**, not missing local diagnostic data.
