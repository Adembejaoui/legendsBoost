# SUPABASE REALTIME FOUNDATION — REMEDIATION RECORD (Phase 1.1)

**Date:** 2026-11-11  
**Scope:** Remediation-only. No application component migration to Supabase Realtime. REST/order lifecycle/historical migrations unchanged (no reset/push).

## 1. Blockers addressed (root cause, change, status)

| Blocker | Root cause | Files changed | Result |
|---|---|---|---|
| `DIRECT_URL` required / Prisma validate/build coupling | Prisma CLI config (`prisma.config.ts`) uses `env('DIRECT_URL')` for datasource/migrations while runtime uses `DATABASE_URL` via pg adapter (`lib/prisma.ts`); environments missing `DIRECT_URL` fail CLI validate/generate. | `prisma.config.ts` (inspected, kept correct), `.env.example` (inspected, documents both), runtime separation confirmed in `lib/prisma.ts` | **Partially resolved:** `npx prisma validate` passes when env provided; remains env/config requirement to set `DIRECT_URL` (and `DATABASE_URL`) in local/CI/deploy. No dummy creds added. |
| TypeScript cannot resolve `bcryptjs` definitions | `@types/bcryptjs@2` present in deps/node_modules conflicts with `bcryptjs@3` bundled types; `tsc` auto type discovery picked up incompatible defs. | `package.json` (removed `@types/bcryptjs`), `tsconfig.json` (added explicit `types: ["node","react","react-dom"]`), removed `node_modules/@types/bcryptjs` locally | **Partially resolved:** bcryptjs typing conflict mitigated. Repo-wide `tsc --noEmit` still **fails/blocked** due to many pre-existing test/app errors and environment-specific package type resolution; not fully green. |
| `npm run lint` invalid project directory | Script was `eslint` with no target, causing CLI to treat argument/path incorrectly in this setup. | `package.json` (`lint`: `eslint .`) | **Script fixed; execution inconclusive** (full lint run timed out/hung in environment). |
| Supabase admin env throws in non-configured contexts | `getSupabaseAdmin()` threw on missing server env, breaking code paths/tests that should tolerate broadcast best-effort. | `lib/supabase/server.ts`, `lib/realtime/broadcast.ts` | **Resolved:** admin client nullable; broadcast skips with logged error when unconfigured, preserving DB-as-source-of-truth and no-throw post-commit behavior. |
| Realtime JWT secret/key handling fragile | Secret captured at module load and key encoding caused `jose` HS256 signing issues in tests/runtime contexts. | `lib/supabase/realtime-auth.ts` | **Resolved (code-level):** secret read at runtime, HS256 signing/verification uses compatible key bytes; unit tests pass. Project-level signing compatibility remains unverified. |
| Suspended/inactive/deleted account enforcement incomplete | Token path and channel authorization did not consistently revalidate account eligibility against current DB state; booster suspension not gated for realtime. | `lib/auth/guards.ts`, `app/api/realtime/auth/route.ts`, `lib/realtime/authorization.ts` | **Partially resolved:** canonical DB revalidation added. Boosters require `BoosterProfile.verificationStatus === APPROVED` (existing field); deleted users denied. No general user suspension/inactive field exists in schema—no model invented. |
| Active-connection revocation advisory-only | `revokeOrderAccess` only broadcasts event; existing JWT/connection may persist. | Investigated `lib/realtime/broadcast.ts`, `lib/assignments/service.ts`, `lib/realtime/*` | **Unresolved/blocked:** no guaranteed immediate revocation demonstrated; requires supported Supabase mechanism and real connected-client staging proof. |
| Supabase JWT project config unverified | No access to actual project signing-key settings/requirements. | Docs/tests only | **Blocked.** |
| Private-channel/RLS policies unverified | No repo policies/migrations and no staging project inspection. | Inspected migrations/repo; no SQL executed | **Blocked.** |
| Staging security tests not executed | No Supabase staging credentials/access. | N/A | **Blocked.** |

## 2. Files changed (remediation)
- `package.json` — fixed `lint` script; removed conflicting `@types/bcryptjs`.
- `tsconfig.json` — constrained automatic type inclusion (`types`).
- `lib/auth/guards.ts` — added `SessionUser`, `getRealtimeEligibleUser()` (canonical DB + booster approval gate).
- `app/api/realtime/auth/route.ts` — token issuance uses eligible realtime user.
- `lib/realtime/authorization.ts` — per-check DB eligibility revalidation; fail-closed for ineligible/deleted users.
- `lib/supabase/server.ts` — nullable `getSupabaseAdmin()` when env missing.
- `lib/realtime/broadcast.ts` — safe handling when admin client unavailable.
- `lib/supabase/realtime-auth.ts` — runtime secret resolution and HS256 key handling.
- `__tests__/realtime/authorization.test.ts` — added **unit/mocked** channel authorization tests.
- `__tests__/realtime/realtime-auth.test.ts` — added **unit** JWT issue/verify/expiry/wrong-secret tests.
- `docs/SUPABASE-REALTIME-FOUNDATION-VERIFICATION.md` — updated verification report.
- `docs/SUPABASE-REALTIME-FOUNDATION-REMEDIATION.md` — this record.

## 3. Security decisions
- **Canonical identity/authorization:** always derived from Auth.js session + DB lookup; never trust client-supplied user IDs/roles. Channel authorization rechecks DB state per request.
- **Account-state policy (existing fields only):** deleted/missing DB user denied; boosters must be `APPROVED` in `BoosterProfile` for realtime eligibility (rejects `PENDING/REJECTED/SUSPENDED`). No new schema/state invented.
- **Fail closed:** missing auth, ineligible account, unknown channel, or unauthorized resource → deny token/access; no public-channel fallback.
- **Secrets:** `SUPABASE_JWT_SECRET`/service-role keys never logged or returned; browser uses anon public keys only.
- **Broadcast safety:** post-commit broadcast failures do not roll back persisted data; missing server config logs and skips.
- **Revocation:** advisory `order.access_revoked` retained but **not treated as sufficient security**; DB-state checks govern new authorization. Immediate cutoff not claimed.

## 4. Tests and actual results
| Test/check | Type | Result |
|---|---|---|
| `__tests__/realtime/authorization.test.ts` | Unit (mocked DB/services) | **PASS** (8 tests) — unknown channel, deleted/ineligible, suspended/non-approved booster, approved self, cross-user deny, order delegation/deny, support owner/unauthorized/admin. |
| `__tests__/realtime/realtime-auth.test.ts` | Unit | **PASS** (4 tests) — issue/verify claims, invalid token, expired token, wrong-secret rejection. |
| `__tests__/assignments/reassignment-revocation.test.ts` | Unit (mocked) | **PASS** (6 tests) — verifies advisory `revokeOrderAccess`/assignment flows invoked; **not** proof of real Supabase disconnect/revocation. |
| `__tests__/assignments.service.test.ts` | Unit/service (mocked) | **FAIL** (3 failed, 19 passed) — claim/pause assertions mismatched in this run; not altered. |
| `prisma validate` (env provided) | Tooling | **PASS** |
| `tsc --noEmit` | Static | **FAIL/BLOCKED** (pre-existing/environment issues) |
| `npm run lint` (`eslint .`) | Static | **BLOCKED/INCONCLUSIVE** (timeout) |
| `next build` | Build | **BLOCKED/INCOMPLETE** (timeout) |
| Real Supabase staging integration & required 2-client active-connection revocation | Staging integration | **BLOCKED** (no access) |

**Never claimed:** mocked/unit tests do not prove Supabase RLS, project JWT compatibility, or real active-connection revocation.

## 5. Staging verification evidence
- **Unavailable.** No Supabase project/staging credentials or environment access provided. Required connected-client reassignment scenario not executed.

## 6. Remaining limitations
- Immediate revocation for already-connected clients not guaranteed/demonstrated.
- Supabase project JWT signing configuration and RLS/private-channel policies not verified.
- No universal user account suspension/inactive field; enforcement limited to existing booster verification status and DB existence.
- Full repository lint/type/build not green in this environment; some existing tests failing.
- Realtime client integration concerns (refresh, dedupe, strict unsubscribe on revocation/errors) deferred to approved component-migration phases.

## 7. Final verdict
**FAIL**

Rationale: foundational code hardening and targeted unit coverage improved, but mandatory blockers remain unproven/unresolved (real Supabase project config + RLS, guaranteed/verified active-connection revocation, staging integration evidence, and complete verification pipeline). Component migration must not start; await explicit approval.
