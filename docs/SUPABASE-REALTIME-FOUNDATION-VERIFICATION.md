# SUPABASE REALTIME FOUNDATION — PHASE 1 VERIFICATION (Remediated)

**Date:** 2026-11-11  
**Scope:** Phase 1/1.1 remediation verification for Supabase Realtime auth/authorization foundation only. No chat/notifications/support UI migration, no presence/typing/read receipts. REST preserved.  
**Verdict:** **FAIL** (remediation incomplete; critical blockers remain unverified/unresolved for production approval)

## 1. Summary of remediation
- **Tooling/env:** lint script corrected (`eslint .`); conflicting `@types/bcryptjs` dependency removed (bcryptjs ships types); `tsconfig` type scoping adjusted; `prisma.config.ts`/`.env.example` confirmed to use `DIRECT_URL` for Prisma CLI datasource and `DATABASE_URL` for runtime pool (`lib/prisma.ts`). `npx prisma validate` passes when `DIRECT_URL`/`DATABASE_URL` are provided. Server Supabase admin client/broadcast made non-throwing when env absent (logs/skips broadcast; DB remains source of truth). Realtime JWT module now reads secret at call time and signs/verifies with HS256 key bytes compatible with `jose`.
- **Account-state enforcement:** added `getRealtimeEligibleUser()` and DB-backed eligibility revalidation in realtime authorization; token endpoint now requires eligible canonical DB user. Boosters must have existing `BoosterProfile.verificationStatus === "APPROVED"` (PENDING/REJECTED/SUSPENDED denied) using existing fields; deleted users denied by DB lookup. No client-supplied identity/role trusted.
- **Authorization hardening:** `canAccessChannel` revalidates canonical account eligibility on every check, enforces private channel parsing, self-only `user` channel, DB-backed order access (`canAccessConversation`, current active assignment/owner/admin), and DB-backed support ticket access (owner/admin).
- **Still unresolved/blocked:** active-connection revocation guarantee, Supabase project JWT/signing-key compatibility, Supabase private-channel/RLS policy verification, staging integration tests (including required two-client revocation scenario), and full repo lint/type/build green status in this environment.

## 2. Auth.js-to-Supabase identity bridge (current)
- **Auth:** NextAuth/Auth.js (`auth.ts`) with Google + Credentials, JWT session strategy, `AUTH_SECRET`. JWT/session callbacks populate id/role from DB on sign-in; profiles ensured for Google customers.
- **Canonical identity:** `getServerSession(authOptions)` + `prisma.user.findUnique` by session user id. `getSessionUser()` returns DB-backed id/email/role; `getRealtimeEligibleUser()` additionally enforces booster approval via existing `BoosterProfile.verificationStatus`. Missing/deleted users → null/denied.
- **Token issuance:** `POST /api/realtime/auth` (`force-dynamic`, rate-limited) requires eligible session, validates channel, authorizes via `canAccessChannel` (DB/current state) before `issueRealtimeToken`. Returns only `{ success, token, expiresInMs }`; no secrets exposed.

## 3. JWT configuration and security (code-level)
- **Implementation:** `lib/supabase/realtime-auth.ts` signs with `SUPABASE_JWT_SECRET` (server-only, read at runtime), HS256, claims `sub`, `role` (`authenticated`), `aud=authenticated`, `iat`, `exp`, optional `channel`; default TTL 15 minutes. Verification enforces HS256 and string `sub`, rejects invalid/expired/wrong-secret tokens.
- **Project compatibility:** **BLOCKED/NOT VERIFIED** against actual Supabase project (signing-key model, issuer/audience/required claims, rotation, supported algs, refresh semantics). No project access/credentials available; do not assume legacy secret compatibility.

## 4. Private-channel authorization and RLS
- **Namespaces:** `private-order:{orderId}`, `private-user:{userId}`, `private-support:{ticketId}` only.
- **Rules:** order access delegated to `canAccessConversation` (order owner, ADMIN, or active assigned booster; DB current state); user channel self-only; support channel ticket owner or ADMIN. Unknown channels and ineligible accounts denied.
- **RLS/policies:** **NOT VERIFIED**. No repo `supabase/` config or migration SQL policies found for Realtime/RLS. Actual Supabase project private-channel enforcement, `realtime.messages` policies, and public-subscription prevention cannot be confirmed without staging/project inspection.

## 5. Active-connection revocation strategy
- **Current behavior:** `revokeOrderAccess` emits advisory `order.access_revoked` to `private-user:{userId}` after reassignment/release/cancel/complete/abandon flows. It does **not** forcibly disconnect/unsubscribe existing clients or invalidate unexpired JWTs. New token/channel authorization rechecks current DB state and should deny former/unassigned/ineligible users.
- **Guarantee:** **Immediate revocation NOT demonstrated and NOT guaranteed.** Bounded exposure window possible (up to token TTL / until client honors advisory event) absent verified platform-enforced revalidation/disconnect.
- **Required staging scenario (Customer + Booster A → reassign to Booster B):** **BLOCKED** (no Supabase staging credentials/access). Not executed; no connected-client evidence.

## 6. Client initialization and token refresh (foundation state)
- Browser clients use anon `NEXT_PUBLIC_SUPABASE_*` only, non-persistent/no auto-refresh/detectSessionInUrl; realtime auth via `setRealtimeToken`. Service-role/JWT secrets remain server-only. Subscription helpers require private channels. UI integration (refresh, dedupe, fail-closed handling, revocation unsubscribe) remains future-phase work.

## 7. Tests and verification results
| Check | Result | Notes |
|---|---|---|
| `npx prisma validate` (with `DIRECT_URL`/`DATABASE_URL` provided) | **PASS** | Schema valid; CLI requires configured datasource env (`prisma.config.ts` uses `DIRECT_URL`). Blocked in envs missing it. |
| `npx vitest run __tests__/realtime/authorization.test.ts __tests__/realtime/realtime-auth.test.ts __tests__/assignments/reassignment-revocation.test.ts` | **PASS (18/18)** | **Unit/mocked** (mocked Prisma/chat service, local JWT). Not proof of Supabase RLS or real active-connection behavior. |
| `npx vitest run __tests__/assignments.service.test.ts` | **FAIL (3 failed, 19 passed)** | Failures observed in claim/pause expectations; indicates possible pre-existing/mock-contract drift vs current service return/broadcast behavior. Not modified to weaken behavior. |
| `npx tsc --noEmit` | **BLOCKED/FAIL (repo-wide)** | Numerous pre-existing type errors across tests/app and environment-specific stray package type resolution; realtime/bcryptjs-specific conflict mitigated but full clean typecheck not achieved. |
| `npm run lint` / `npx eslint .` | **BLOCKED/INCONCLUSIVE** | Script fixed to `eslint .`; full run timed out/hung in this environment, not completed as proof. |
| `npx next build` | **BLOCKED/INCOMPLETE** | Did not complete within available execution window in this environment. |
| Real Supabase staging auth/channel/RLS/revocation tests (incl. required 2-client reassignment) | **BLOCKED** | No staging project access/credentials. |

### Required security cases coverage
Unauthenticated/expired session/suspended or ineligible booster/deleted user/valid identities/former-unassigned/wrong owner/unauthorized support/cross-user/token expiry & wrong-secret/refresh: **partially covered by code-path changes and mocked unit tests only**. Active-connection revocation, real JWT/project config, and RLS: **not demonstrated**.

## 8. Remaining risks and limitations
- Immediate active-connection revocation unproven/unavailable as guaranteed control in current design.
- Supabase project JWT/RLS/private-channel enforcement unverified.
- Customer/admin account suspension/inactive model not represented in schema; only existing booster verification status enforced.
- In-memory rate limiting not distributed.
- Full lint/type/build and assignment-service test regressions/unresolved issues remain in this environment.
- Token refresh/dedupe/fail-closed client integration pending future approved phases.

## 9. Final verdict
**FAIL.** Phase 1.1 remediation improved local verification posture and DB-backed realtime eligibility/authorization checks, but mandatory production-approval evidence is missing (staging project/JWT/RLS validation, real connected-client revocation, and complete clean verification pipeline).
