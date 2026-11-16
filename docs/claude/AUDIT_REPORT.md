# LegendsBoost: Audit Report (codebase vs. Boosting Platform Spec)

**Audit date:** 2026-11-12
**Spec:** "Boosting Platform: Audit Report and Build Spec" (supplied in the audit request; the file is **not** in `docs/` in this repo).
**Scope:** read-only audit of the working tree on `main` (commit `acef492` plus a large uncommitted working set). No source files were changed.
**Out of scope (per instructions):** catalog and service creation. Only the presence of `catalog.seed.json` and a price function was checked.

Status legend: **DONE** (implemented and correct, with evidence), **PARTIAL** (exists but incomplete, wrong, or untested), **MISSING**, **DEFERRED** (later phase or explicitly out of scope), **SPEC-CONFLICT**, **UNVERIFIED** (could not confirm from the repo).

---

## 1. Summary

161 atomic requirements checked (section 4). Counts are computed from the checklist rows.

| Section | DONE | PARTIAL | MISSING | DEFERRED | SPEC-CONFLICT | UNVERIFIED | Total |
|---|---|---|---|---|---|---|---|
| 4 Roles | 0 | 4 | 3 | 0 | 0 | 0 | 7 |
| 5 Booster | 4 | 16 | 25 | 1 | 0 | 0 | 46 |
| 6 Customer | 3 | 7 | 21 | 3 | 0 | 0 | 34 |
| 7 Tracker | 3 | 1 | 15 | 1 | 1 | 0 | 21 |
| 8 Technical | 3 | 15 | 16 | 0 | 0 | 1 | 35 |
| 9 Phases | 0 | 3 | 2 | 2 | 0 | 0 | 7 |
| Spec conflicts | 0 | 0 | 0 | 0 | 7 | 0 | 7 |
| QA (tests/tsc/lint) | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| Legal (0.3) | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| **Overall** | **13** | **49** | **83** | **7** | **8** | **1** | **161** |

Three of the tracker DONEs (Riot key server-only, Riot ID display, no MMR) are vacuous: no Riot integration exists to get them wrong. Separately, C11 (Realtime RLS enforcement) is UNVERIFIED because the Supabase policies are not in the repo.

Critical findings: **2 Blocker, 6 High, 7 Medium, 6 Low** (section 3).

**Bottom line.** The repo covers roughly the first half of spec Phase 2: booster application and review, a booster claim pool with a DB-enforced one-active-assignment rule, pause/resume/complete/release, order chat over Supabase Realtime, notifications, and support tickets. **Nothing from the money system (payments, escrow, ledger, payouts, fines, refunds, disputes) exists, and nothing from the tracker (Riot API, PUUID, snapshots, matches, progress) exists.** One Blocker affects what is already built: orders created as unpaid drafts land directly in the booster claim pool.

---

## 2. Orientation

| Item | Finding |
|---|---|
| Stack | Next.js 16.4.3 (App Router) + React 19.3 + TypeScript 5, Tailwind 4, shadcn/base-ui |
| Package manager | npm (`package-lock.json`), Node 24.x |
| DB / ORM | PostgreSQL (Supabase) via Prisma 7.10 with `@prisma/adapter-pg`; client generated to `app/generated/prisma` |
| Migrations | `prisma/migrations/` (8 migrations, last `20261102210000_simplify_order_statuses`). **Drift:** 5 models in the schema have no migration (see C7) |
| Auth | next-auth v4 (JWT sessions) with Google + Credentials (bcrypt, 12 rounds); `@auth/prisma-adapter` |
| Realtime | Supabase Realtime private channels; server broadcasts via REST `httpSend`; custom JWT bridge at `/api/realtime/auth` |
| Tests | Vitest 5.0.5 (jsdom), 11 test files in `__tests__/` |
| Job queue / cron | **None** (no BullMQ, pg-boss, cron, or Vercel cron config) |
| Payments | `@stripe/stripe-js` client only, with a disabled preview form. No server SDK, no webhook |
| Noise in tree | `package/` (a vendored copy of the `next` package) is inside the tsc and ESLint scope; `prisma/schema.prisma.tmp`, empty `x.txt`, `__tests/` (empty sibling of `__tests__`) |

### 2.1 Test, typecheck, lint results

| Check | Command | Result |
|---|---|---|
| Tests (default config) | `npx vitest run` | **11/11 files fail to load, 0 tests run.** Error: `Vitest failed to find the runner` / `Cannot read properties of undefined (reading 'config')` on the first `describe`. Cause: default `forks`/`threads` pools on this Windows + Vitest 5 setup. Reproduced with a corrected alias and with no setup file, so neither is the cause |
| Tests (`--pool=vmThreads`) | `npx vitest run --pool=vmThreads` | **51 tests: 45 pass, 6 fail. Files: 4 pass, 7 fail** (details below) |
| Typecheck | `npx tsc --noEmit` | **37 errors.** 12 in app/lib/components, 24 in `__tests__`, 1 in `package/` |
| Lint (whole repo) | `npx eslint .` | **80,637 problems (10,703 errors, 69,934 warnings)**, almost entirely from the vendored `package/` tree, which ESLint does not ignore. Took ~25 min. Not usable as configured |
| Lint (source only) | `npx eslint app lib components auth.ts __tests__ --ignore-pattern "app/generated/**"` | **167 errors, 121 warnings.** 139 errors are `no-explicit-any`. High-signal: `react-hooks/rules-of-hooks` (`components/game/faq-accordion.tsx:33`, conditional `useState`), `react/jsx-no-undef` (`components/support/SupportTicketList.tsx:98`, `User` icon not imported), 3x `react-hooks/immutability`, 8x `set-state-in-effect` |

Test failures under `vmThreads`:

| File / test | Failure | Real bug or env? |
|---|---|---|
| `assignments.service.test.ts` > claims a PENDING order atomically | `TypeError: reading 'toISOString'`. The mock assignment lacks `assignedAt`, and `claimOrder` broadcasts `assignedAt.toISOString()` (`lib/assignments/service.ts:272`) | Test drift |
| `assignments.service.test.ts` > concurrent claims: exactly one succeeds | Got 0 fulfilled (same `toISOString` throw). The test also **mocks Prisma**, so it never exercises the DB constraint | Test drift; weak test |
| `assignments.service.test.ts` > pause keeps assignment active | Expects an assignment; `pauseAssignment` now returns `{assignment, order}` | Test drift |
| `realtime/realtime-auth.test.ts` (3 tests) | `crypto.subtle.importKey` undefined | vmThreads env artifact |
| `auth/password.test.ts` | "No test suite found". It is a standalone `tsx` script, not a Vitest suite | Test structure |
| `riot/routing.test.ts` | Imports `@/lib/riot/lol/routing`, **which does not exist** (never committed; `git log` shows no `lib/riot`) | Missing module |
| `security/rate-limit.test.ts` | Imports `ORDER_MESSAGE_RATE_LIMIT`, `clearRateLimit`, which are not exported by `lib/security/sanitize.ts` (also 19 tsc errors) | Test/code drift |
| `security/sanitize.test.ts`, `support/ticket-transitions.test.ts` | `ReadableStream is not defined` (DOMPurify/jsdom under vm context) | vmThreads env artifact |

Source typecheck errors: `app/checkout/review/review-client.tsx:15`, `components/payment/PaymentPageClient.tsx:15`, `components/dashboard/customer/CustomerOrderFilter.tsx:19,31,57`, `components/dashboard/DashboardShell.tsx:44` (nullable `useSearchParams`/`usePathname`), `components/support/SupportTicketList.tsx:98` (`User` undefined), `lib/support/service.ts:52` (local `SupportTicketCategory` includes `ACCOUNT_ISSUE`, which the Prisma enum lacks).

---

## 3. Critical findings (money, security, data leakage, concurrency)

Sorted by severity. "Missing system" items, such as the absence of a ledger, are listed once here as launch blockers. Everything else is a defect in code that exists today.

| # | Sev | Category | Finding | Evidence |
|---|---|---|---|---|
| C1 | **Blocker** | Money / state | **Unpaid orders are immediately claimable.** `POST /api/orders` creates orders with `status = PENDING`, no price, and no payment. `PENDING` is also the "open pool" status that `claimOrder` and `getAvailableOrders` accept. The catalog marks every service `orderCapability: 'draft-only'`, `allowOrder: false`, but the API never checks either flag, so the UI's "Create order draft" button puts a free order into the booster pool | `app/api/orders/route.ts:46-59`; `lib/assignments/service.ts:77-84,194`; `lib/config/checkout-options.ts:44-46,128`; `components/checkout/CheckoutPanel.tsx:140` |
| C2 | **Blocker** | Money | **No payment, escrow, or ledger exists.** No `payments`, `ledger_entries`, `payouts`, `refunds`, or `booster_fines` tables; no webhook route; no `PaymentProvider`. `Order.price` is `Decimal(10,2)` (not minor units) and is never written. Booster earnings page is a "Coming Soon" placeholder | `prisma/schema.prisma:154-178` (`price Decimal?` at :163); `app/dashboard/booster/cashout/page.tsx:60-95`; grep for `webhook\|ledger\|payout\|refund`: 0 hits in code |
| C3 | **High** | Data leakage | **Boosters receive the customer price, the customer's real name, and the Riot ID before claiming.** `getAvailableOrders` returns full `Order` rows (`price`, `currency`, `configuration` incl. `riotGameName/riotTagline`) plus `user {id, name}`. They go out as JSON from `GET /api/booster/orders/available` and are serialized to the client as RSC props via `initialOrders={orders as any}`. The workspace renders **"Total: {price}"** to boosters | `lib/assignments/service.ts:90-102`; `app/api/booster/orders/available/route.ts:21-23`; `app/dashboard/booster/available-orders/page.tsx:63,73`; `app/dashboard/[orderId]/page.tsx:101-104`; `components/orders/workspace/OrderWorkspace.tsx:111` |
| C4 | **High** | Data leakage | **Released/past boosters keep reading order data.** `GET /api/booster/orders/claimed` returns `getBoosterAssignments(user.id, "all")` with `include: { order: true }` for COMPLETED/RELEASED/CANCELLED assignments: price, full configuration, Riot ID. It is also not gated on booster verification status (a SUSPENDED booster still gets it) | `app/api/booster/orders/claimed/route.ts:11-15`; `lib/assignments/service.ts:111-136` |
| C5 | **High** | Money / authz | **A booster can cancel the customer's order outright.** `cancelAssignment` (booster or admin) moves the *order* to `CANCELLED` from IN_PROGRESS/PAUSED. There is no refund, no support review, and no customer-side cancel at all. Spec 6.5 makes cancellation a customer/support action with a refund matrix; boosters should only *release* | `lib/assignments/service.ts:541-640` (order update :579-582); `app/api/booster/orders/[orderId]/cancel/route.ts:18-31` |
| C6 | **High** | Authz / roles | **Single-role model breaks multi-role users.** `User.role` is one enum. Approving an application overwrites `CUSTOMER` with `BOOSTER`, after which the order page sends the user down the booster branch and `notFound()`s their **own customer orders** (no assignment). Spec 4.1 requires role flags | `prisma/schema.prisma:39`; `app/api/admin/boosters/[userId]/approve/route.ts:65-68`; `app/dashboard/[orderId]/page.tsx:30-43` |
| C7 | **High** | Data integrity | **Migration drift.** `Notification`, `OrderConversation`, `OrderMessage`, `SupportTicket`, `SupportMessage` (and their enums) exist in `schema.prisma` but in **no** migration. `prisma migrate deploy` on a fresh database will not create chat, notification, or support tables. `prisma.config.ts` also references a missing `prisma/seed.ts` | `prisma/schema.prisma:219-353`; `grep -l notification\|orderConversation\|supportTicket prisma/migrations/*/migration.sql`: no hits; `prisma.config.ts:7` |
| C8 | **High** | Concurrency / QA | **Acceptance test 1 is not proven.** The DB-level claim guard is sound (C-check below), but the only concurrency test mocks Prisma, never reaches Postgres, and currently fails. The test suite does not run at all with the repo's default config | `__tests__/assignments.service.test.ts:258-289`; section 2.1 |
| C9 | Medium | State machine | **No single `transitionOrder`.** 10 direct `order.update({status})` writes. `release`/`abandon` move IN_PROGRESS/PAUSED → PENDING, a transition **absent** from `ORDER_STATUS_TRANSITIONS`. `startAssignment` and `reassignOrder` update order status with **no status guard** | `lib/assignments/service.ts:211,340,400,482,579,680,811,863,951,1080`; table `lib/assignments/types.ts:53-59` |
| C10 | Medium | Security | **Rate limiting is in-memory and per instance** (two duplicate implementations), so it is ineffective on serverless or multi-instance deployments. **No limit** on credentials login, register, claim, or booster apply. `/api/realtime/auth` keys on the client-controlled `x-forwarded-for` header | `lib/rate-limit.ts:14`; `lib/security/sanitize.ts:36`; `auth.ts:21-60`; `app/api/auth/register/route.ts`; `app/api/realtime/auth/route.ts:31-35` |
| C11 | Medium | Security | **Access revocation is advisory.** On release/complete/cancel, `revokeOrderAccess` only broadcasts `order.access_revoked` asking the client to unsubscribe. The Realtime JWT stays valid for 15 minutes. Whether Supabase rejects the former booster depends on Realtime RLS policies that are **not in this repo** (UNVERIFIED) | `lib/realtime/broadcast.ts:252-270`; `lib/supabase/realtime-auth.ts:24` |
| C12 | Medium | Authz | **Suspended boosters keep order and chat access.** `canAccessConversation` checks only the assignment, not `verificationStatus`. `GET/POST /api/orders/[id]/messages` use `getSessionUser` (no status gate). The order page does not check status either | `lib/chat/service.ts:68-88`; `app/api/orders/[orderId]/messages/route.ts:11-19`; `app/dashboard/[orderId]/page.tsx:37-44` |
| C13 | Medium | Data leakage | **Chat is not anonymous and not moderated.** Messages and broadcasts carry the sender's real `User.name` and image. There is no detection of emails, phone numbers, Discord handles, or PayPal strings; only XSS stripping | `lib/chat/service.ts:105-142` |
| C14 | Medium | Data integrity | **Customer can rewrite the Riot ID at any status**, including IN_PROGRESS and COMPLETED. It is stored as free-form keys inside `configuration` JSON, with no PUUID and an optional tagline defaulting to `""` | `app/api/orders/[orderId]/game-account/route.ts:6-36` |
| C15 | Medium | Correctness | **Wrong event semantics shown to users.** Booster cancel sends an `ORDER_COMPLETED` notification. Complete broadcasts `newStatus: "PAUSED"` | `lib/assignments/service.ts:607-612`; `lib/assignments/service.ts:525-536` |
| C16 | Low | Authz | Booster mutation routes check `assignment.orderId === orderId` **after** the mutation has committed, so a mismatched URL still executes the action and then returns 403. Ownership is still enforced in the service | `app/api/booster/orders/[orderId]/{cancel,complete,pause,release,resume}/route.ts:31-35` |
| C17 | Low | Data leakage | `POST /api/support/tickets` accepts any `orderId` without an ownership check. The returned ticket includes that order's `gameSlug/serviceSlug/status` | `lib/support/service.ts:26-60` |
| C18 | Low | Concurrency | `verifyBoosterEligibility` runs **before** the claim transaction, so a booster suspended mid-claim can still claim | `lib/assignments/service.ts:170-174` |
| C19 | Low | Availability | `POST /api/orders/draft` is unauthenticated, has no rate limit, and writes to a process-global `Map` that is never pruned (unbounded memory) | `app/api/orders/draft/route.ts:6-52`; `lib/orders/draft-store.ts:3` |
| C20 | Low | Correctness | Support category `ACCOUNT_ISSUE` passes API validation but is not in the Prisma enum, so it causes a 500. `SupportTicketList` references an un-imported `User` icon | `app/api/support/tickets/route.ts:58`; `prisma/schema.prisma:254-260`; `components/support/SupportTicketList.tsx:98` |
| C21 | Low | Correctness | Payment page reads `data.draft` from `GET /api/orders/[id]`, which returns `{ order }`, so the page always shows "Order not found". The Stripe amount is hard-coded to `0` and Pay is permanently disabled | `components/payment/PaymentPageClient.tsx:35,86`; `components/payment/StripePaymentForm.tsx:8` |

### 3.1 Deep checks A to J

**A. Money: FAIL (absent).** No ledger. The single money column `Order.price` is `Decimal(10,2)` (`prisma/schema.prisma:163`), not integer minor units, and no code path writes it. There is no booster balance column, and no balance of any kind. Fines, refunds, and clawbacks: none.

**B. State machine: FAIL.** No `transitionOrder` (grep: 0 hits). Writers of `orders.status`: `app/api/orders/route.ts:48` (create) plus 10 updates in `lib/assignments/service.ts` (lines in C9). Table vs. spec 8.2: code has 5 states (`PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED`, `prisma/schema.prisma:135-141`). Spec has 11 (`PENDING_PAYMENT, PAID/OPEN, CLAIMED, IN_PROGRESS, PAUSED, TARGET_REACHED, COMPLETED, CONFIRMED, CANCELLED, REFUNDED, DISPUTED`). The table is consulted only by `completeAssignment` (`service.ts:464`). Unit test "supports the simplified lifecycle transitions" passes, but it tests the table, not the writers.

**C. Claim atomicity: PASS for the single-claim race; FAIL for the rest.**
- Atomic: `claimOrder` runs in `$transaction`, creates the assignment with `activeOrderId = orderId`, then `order.update({ where: { id, status: "PENDING" } })` (Prisma throws P2025 when 0 rows match, which rolls back). Backed by `@@unique([activeOrderId])` (`schema.prisma:212`) and the check constraint `orderBoosterAssignment_active_order_check` (migration `20261102210000_simplify_order_statuses`). P2002 and P2025 are mapped to "already claimed" (`service.ts:288-303`). Two concurrent claimers cannot both commit.
- Not enforced: game/tier/region/service permissions (no `booster_permissions` table), max concurrent orders per booster, preferred-booster window. None exist, inside or outside the transaction. Eligibility (APPROVED) is read **before** the transaction (C18).

**D. Payments: FAIL (absent).** No webhook route, no signature verification, no idempotency. The only thing that reaches "claimable" is order creation itself (C1). There is no redirect-trust issue only because there is no payment.

**E. Secrets/credentials: FAIL (absent).** No `order_credentials`, no encryption, no reveal endpoint, no `audit_log`, no retention job. The customer game-account panel stores only a Riot ID in plaintext JSON (C14). Supabase service-role and JWT secrets are server-only (`lib/supabase/server.ts`, `.env.example:21-25`), which is correct.

**F. Data leakage: FAIL (booster side).**
- Customer endpoints: no payout or fee fields exist in the schema, so `GET /api/orders`, `GET /api/orders/[id]`, and `PATCH /api/orders/[id]/game-account` cannot leak them today. **Re-check once payout fields are added:** all three return raw Prisma rows.
- Booster endpoints leaking customer price or account data:
  - `GET /api/booster/orders/available`: `price`, `currency`, `configuration` (Riot ID), `user.name`.
  - `GET /api/booster/orders/claimed`: `order: true` for all historical assignments.
  - Page `/dashboard/booster/available-orders`: same rows serialized as RSC props.
  - Page `/dashboard/[orderId]` (booster view): `price` rendered as "Total".
  - `GET/POST /api/orders/[id]/messages` and Realtime `chat.message.created`: customer's real name and image.

**G. Authorization:** see the route/guard table in section 5. Every API route checks a session except `POST /api/auth/register` (public by design), `POST /api/orders/draft` (unauthenticated, C19), and NextAuth. Rate limits: chat POST, support POST, typing, realtime-auth only (all in-memory). **Missing on login, register, claim, apply; payouts don't exist.**

**H. Tracker: FAIL (absent).** No Riot client. `RIOT_LOL_API_KEY` is declared server-only in `.env.example:27` but used nowhere. `lib/riot/lol/routing` (platform/regional routing) is imported by a test but missing. No rate limiter for Riot, no cache, no snapshots, no `lp_delta`, no progress scale. No MMR is displayed (grep `mmr`: 0 hits), trivially compliant. **No "not endorsed by Riot Games" disclaimer anywhere** (footer and layout checked). Riot ID (`name#tag`) is the only identifier shown (`OrderWorkspace.tsx:117,130`), which is correct.

**I. Jobs: FAIL (absent).** None of `riot.pollActiveOrders`, `order.slaWatcher`, `order.autoConfirm`, `payout.processor`, `payment.reconcile`, `retention.purge`, `notification.dispatcher` exist. No scheduler. The only intervals are rate-limit cache sweeps (`lib/rate-limit.ts:60`, `lib/security/sanitize.ts:84`). `instrumentation.ts` is a no-op.

**J. Acceptance tests:** see section 6.

---

## 4. Requirement checklist

Evidence paths are repo-relative. "n/f" = not found after grepping code, schema, and migrations.

### 4.1 Roles and permissions (spec 4)

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| ROLE-4.1-01 | Guest can browse, configure, and check out with email only | MISSING | `app/api/orders/route.ts:20-21` requires a session | Browsing and configuring work anonymously; checkout does not |
| ROLE-4.1-02 | Customer: orders, chat, reviews, wallet, loyalty, linked Riot accounts | PARTIAL | orders `app/api/orders/route.ts`; chat `lib/chat/service.ts` | Reviews, wallet, loyalty, and Riot account linking missing |
| ROLE-4.1-03 | Booster: applications, claim/abandon, chat, earnings, payouts, profile | PARTIAL | `app/api/booster/**` | Earnings and payouts missing; abandon exists only as an unused service fn (`service.ts:1046`) |
| ROLE-4.1-04 | Support role distinct from Admin | MISSING | `prisma/schema.prisma:13-17` (ADMIN/BOOSTER/CUSTOMER only) | |
| ROLE-4.1-05 | Admin: vetting, fines, payout approval, config | PARTIAL | approve/reject `app/api/admin/boosters/**`; support PATCH `app/api/support/tickets/[ticketId]/route.ts:34` | Only vetting and support tickets |
| ROLE-4.1-06 | Multiple roles per user via flags | PARTIAL | `prisma/schema.prisma:39`; approve overwrites role `approve/route.ts:65-68` | Buggy, see C6 |
| ROLE-4.2-01 | `catalog.seed.json` + price function reading it | MISSING | n/f; catalog is TS modules `lib/catalog/*.ts`; every `priceAdjustment` is `{fixed, 0}` (`lib/config/checkout-options.ts:277-332`) | Catalog creation out of scope; the price function is not |

### 4.2 Booster system (spec 5)

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| BOOST-5.1-01 | Lifecycle APPLICANT→UNDER_REVIEW→TRIAL→ACTIVE↔SUSPENDED→TERMINATED / REJECTED | PARTIAL | `prisma/schema.prisma:19-24` (PENDING/APPROVED/REJECTED/SUSPENDED) | No TRIAL or TERMINATED; nothing ever sets SUSPENDED |
| BOOST-5.1-02 | Application form fields | PARTIAL | `lib/boosters/application-schema.ts:7-85`; `app/api/booster/apply/route.ts:106-132` | Has name, Discord, country, timezone, games (region, current/peak rank, main role, years), bio, languages, availability, declarations. Missing: proof/screenshot upload, service kinds (solo/duo/coaching), payout preference, champion pool |
| BOOST-5.1-03 | Admin review: approve to TRIAL, reject with reason, request info | PARTIAL | `app/api/admin/boosters/[userId]/approve/route.ts:50-71`, `reject/route.ts:10-73` (conditional `verificationStatus: PENDING` update; self-review blocked) | Approve goes straight to APPROVED; no request-info; no audit log |
| BOOST-5.1-04 | Trial (`trial_orders_remaining`) | MISSING | n/f | |
| BOOST-5.1-05 | Suspension blocks claiming; existing orders reassigned/handled | PARTIAL | `lib/assignments/service.ts:51-55` blocks non-APPROVED | No suspend action; active orders and chat untouched (C12) |
| BOOST-5.1-06 | Claim gated by `booster_permissions` (game, max tier, regions, kinds) | MISSING | n/f | |
| BOOST-5.2-01 | Private profile: legal name, KYC, payout methods, notes | MISSING | only `applicationData` JSON `schema.prisma:119` | |
| BOOST-5.2-02 | Public profile and `/boosters`, `/boosters/:id` | MISSING | n/f | |
| BOOST-5.2-03 | Computed stats (completion/abandon rate, delays, rating) | MISSING | n/f | |
| BOOST-5.3-01 | Available pool with filters/sort, priority pinned | PARTIAL | `lib/assignments/service.ts:74-109` | Game filter only, sorted by `createdAt` |
| BOOST-5.3-02 | Pool card shows booster payout, never customer price | PARTIAL | `service.ts:90-102` | No payout field; price, customer name, and Riot ID leak (C3) |
| BOOST-5.3-03 | My orders: active, paused, completed, abandoned | PARTIAL | `app/dashboard/booster/claimed-orders/*`; `service.ts:111-136` | Exists; leaks historical order data (C4) |
| BOOST-5.3-04 | Order workspace: requirements, credentials, chat, tracker, controls, notes | PARTIAL | `components/orders/workspace/OrderWorkspace.tsx`; `app/dashboard/booster/orders/[orderId]/OrderActions.tsx:84` | Chat + status controls only; `currentRank`/`targetRank` props passed but never rendered |
| BOOST-5.3-05 | Earnings screen | MISSING | `app/dashboard/booster/cashout/page.tsx:68-95` placeholder | |
| BOOST-5.3-06 | Payout request screen | MISSING | n/f | |
| BOOST-5.3-07 | Rules and fines screen | MISSING | n/f | |
| BOOST-5.3-08 | Profile editor and notifications | PARTIAL | `app/api/booster/profile/route.ts:5-53`; `app/api/notifications/**` | `languages` written unvalidated (`profile/route.ts:33`) |
| BOOST-5.4-01 | Only OPEN (paid) orders claimable | PARTIAL | `service.ts:194` checks `PENDING` | `PENDING` also means unpaid (C1) |
| BOOST-5.4-02 | Atomic claim, exactly one winner | DONE | `service.ts:174-214`; `schema.prisma:212`; check constraint in migration `20261102210000_simplify_order_statuses` | Sound at the DB level; test is mocked and failing (C8) |
| BOOST-5.4-03 | Max concurrent active orders per booster (default 3) | MISSING | n/f | |
| BOOST-5.4-04 | Preferred-booster exclusive window (default 30 min) | MISSING | n/f | |
| BOOST-5.4-05 | SLA deadlines: contact +5 min, start +60 min | MISSING | claim sets IN_PROGRESS immediately `service.ts:205,213` | No CLAIMED state, no deadline columns |
| BOOST-5.4-06 | SLA miss → warning → auto-release + strike | MISSING | n/f | |
| BOOST-5.4-07 | Credentials shown only to assigned booster while active; every reveal logged | MISSING | n/f | |
| BOOST-5.4-08 | No booster-to-booster transfer; only support reassigns | PARTIAL | No transfer route (good); `reassignOrder` admin-only `service.ts:894-1040` | `reassignOrder` has no route or UI |
| BOOST-5.5-01 | Voluntary release: free in 10-min grace, else reason + strike | PARTIAL | `service.ts:642-727`; route `release/route.ts` | Release works; reason optional; no grace window, no strike |
| BOOST-5.5-02 | Released order returns to OPEN with `priority=true` | PARTIAL | `service.ts:680-683` → PENDING | No priority flag |
| BOOST-5.5-03 | Pro-rata booster pay + re-price remainder | MISSING | n/f | |
| BOOST-5.5-04 | Forced release (SLA, 12h inactivity, suspension) | MISSING | n/f | |
| BOOST-5.5-05 | Snapshot rank as new start_state on release | MISSING | n/f | |
| BOOST-5.5-06 | Notify customer and booster on release | DONE | `service.ts:700-711` (`BOOSTER_REMOVED`, `ORDER_REOPENED`) | |
| BOOST-5.5-07 | Revoke credential access; flag password rotation | PARTIAL | `service.ts:698` `revokeOrderAccess` (realtime only) | Advisory (C11); no credentials exist |
| BOOST-5.5-08 | Abandon strike, thresholds | MISSING | n/f | |
| BOOST-5.6-01 | `booster_fines` + deduction via ledger entry | MISSING | n/f | |
| BOOST-5.6-02 | Fine schedule visible to boosters | MISSING | n/f | |
| BOOST-5.6-03 | Strike thresholds → auto-suspend | MISSING | n/f | |
| BOOST-5.7-01 | `booster_payout` stored on order at creation | MISSING | `schema.prisma:154-178` | Spec conflict 1 |
| BOOST-5.7-02 | Earning states PENDING/AVAILABLE/PAID_OUT/CLAWED_BACK | MISSING | n/f | |
| BOOST-5.7-03 | Payout methods, verification, 48h change cooldown | MISSING | n/f | |
| BOOST-5.7-04 | Payout request flow REQUESTED→…→PAID, min threshold, idempotency | MISSING | n/f | |
| BOOST-5.7-05 | KYC gate on first payout | DEFERRED | n/f | Phase 5 |
| BOOST-5.8-01 | All contact through in-platform chat | DONE | `lib/chat/service.ts`; `app/api/orders/[orderId]/messages/route.ts`; `components/chat/OrderChat.tsx` | |
| BOOST-5.8-02 | Anonymous chat (booster display name only) | PARTIAL | `lib/chat/service.ts:114-118,137-138` | Real `User.name` exposed (C13) |
| BOOST-5.8-03 | Auto-moderation of contact info, flagged to support | MISSING | only `sanitizeText` `chat/service.ts:105` | |
| BOOST-5.8-04 | Support can join any order chat | DONE | `lib/chat/service.ts:82` (ADMIN) | No separate Support role |
| BOOST-5.8-05 | Notifications in-app/email/sound for claim, start, pause, milestone, complete, message, SLA | PARTIAL | `lib/notifications/service.ts:55`; `components/notifications/*` | In-app + realtime only; no email; no SLA/milestone events; wrong type on cancel (C15) |

### 4.3 Customer system (spec 6)

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| CUST-6.1-01 | Email/password auth | DONE | `app/api/auth/register/route.ts`; `auth.ts:21-60`; `lib/auth/password.ts` | bcrypt-12 with 72-byte guard (spec suggests argon2, a DECISION) |
| CUST-6.1-02 | Google OAuth | DONE | `auth.ts:12-20,99-120` | |
| CUST-6.1-03 | Discord OAuth | MISSING | `auth.ts` providers | |
| CUST-6.1-04 | Guest checkout + magic-link order access | MISSING | n/f | |
| CUST-6.1-05 | Email verification code | MISSING | `emailVerified` column unused (`schema.prisma:36`) | |
| CUST-6.1-06 | Password reset / forced reset | MISSING | n/f | |
| CUST-6.1-07 | 2FA optional for customers, mandatory for boosters/staff | MISSING | n/f | |
| CUST-6.1-08 | Currency/language prefs; i18n EN+FR from day one | MISSING | `preferredLanguage` column only `schema.prisma:103`; no i18n lib | |
| CUST-6.2-01 | Order form: rank/div, LP bracket, LP gain, server, queue, booster count, solo/duo | PARTIAL | `lib/catalog/game-services.ts:20-50` (currentRank, targetRank); mode `lib/config/checkout-options.ts:47-50` | No LP bracket, LP gain, server, queue, or booster count; workspace shows "Server: Not provided" |
| CUST-6.2-02 | Extras with price modifiers | PARTIAL | `lib/config/checkout-options.ts` options | All `priceAdjustment` values are 0 |
| CUST-6.2-03 | Pure, unit-tested price module | MISSING | n/f | |
| CUST-6.2-04 | ETA computation | MISSING | n/f | |
| CUST-6.2-05 | Server-side validation (desired > current, Flex-only multi-booster, Master cap, duo rules) | MISSING | `app/api/orders/route.ts:12,35-44` (required-field presence only; `configuration: z.record(unknown)`) | |
| CUST-6.3-01 | `PaymentProvider` interface + fake provider | MISSING | `lib/stripe/stripe-client.ts` (client loader only) | |
| CUST-6.3-02 | PENDING_PAYMENT → webhook → PAID → OPEN | MISSING | n/f | See C1 |
| CUST-6.3-03 | Webhooks idempotent + signature-verified | MISSING | n/f | |
| CUST-6.3-04 | Status never changed from browser redirect | MISSING | n/f | No payment flow to evaluate |
| CUST-6.3-05 | Coupons, wallet, cashback | DEFERRED | n/f | Phase 5 |
| CUST-6.3-06 | Ban-risk disclosure checkbox before paying | MISSING | n/f | |
| CUST-6.3-07 | Checkout/payment pages work end to end | PARTIAL | `app/checkout/review/review-client.tsx`; `components/payment/PaymentPageClient.tsx:35,86` | Payment page broken (C21) |
| CUST-6.4-01 | Order page header: id, service, from→to, server, status, ETA | PARTIAL | `components/orders/workspace/OrderWorkspace.tsx:101-112` | No rank path (props unused), no ETA, server always "Not provided" |
| CUST-6.4-02 | Stage timeline + live rank card with progress bar | PARTIAL | `OrderWorkspace.tsx:169-182` | Raw event list + status text |
| CUST-6.4-03 | Match history since start, booster vs customer | MISSING | n/f | |
| CUST-6.4-04 | Activity feed incl. booster notes | PARTIAL | `orderEvent` list; `lib/orders/tracking-service.ts:77-89` | No booster notes/sessions |
| CUST-6.4-05 | Chat with booster and support | DONE | `components/chat/OrderChat.tsx`; `app/dashboard/[orderId]/page.tsx:78-87` | |
| CUST-6.4-06 | Controls: pause/resume, change, cancel, tip, spectate, report | PARTIAL | Support ticket with `orderId` `app/api/support/tickets/route.ts:68` | Pause/resume/cancel are booster-only; no tip/change |
| CUST-6.4-07 | Credentials panel (encrypted), 2FA guidance, post-completion reminder | MISSING | Riot ID only, plaintext `game-account/route.ts:30-36` | |
| CUST-6.4-08 | Confirm completion → review → reorder same booster | MISSING | `CUSTOMER_CONFIRMED` defined but unused `lib/orders/tracking-service.ts:15` | |
| CUST-6.4-09 | Duo variant (no credentials; scheduling; booster Riot ID) | MISSING | n/f | |
| CUST-6.5-01 | Refund matrix by state | MISSING | n/f | |
| CUST-6.5-02 | Customer self-serve cancel of OPEN/CLAIMED orders | MISSING | n/f | Booster can cancel instead (C5) |
| CUST-6.6-01 | Disputes: open, evidence, freeze payouts, resolve, audit | MISSING | n/f | Support tickets are not disputes |
| CUST-6.7-01 | Reviews tied to completed order, tags, hide | DEFERRED | n/f | Phase 5 |
| CUST-6.8-01 | Loyalty | DEFERRED | n/f | Phase 4/5 per spec |

### 4.4 Game tracking (spec 7)

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| TRK-7.2-01 | Capture Riot ID + region at order time | PARTIAL | `app/api/orders/[orderId]/game-account/route.ts:6-36` | Post-order, editable anytime, no region, tagline optional (C14) |
| TRK-7.2-02 | Resolve to PUUID via Account-V1; PUUID canonical | MISSING | n/f | |
| TRK-7.2-03 | Show Riot IDs, not summoner names | DONE | `OrderWorkspace.tsx:117,130` | |
| TRK-7.3-01 | Account-V1, Summoner-V4, League-V4 by-puuid, Match-V5, Spectator-V5 clients | MISSING | n/f | |
| TRK-7.3-02 | platform → regional routing map | MISSING | `__tests__/riot/routing.test.ts:10` imports missing `lib/riot/lol/routing` | Test is already written |
| TRK-7.3-03 | Riot key server-side only | DONE | `.env.example:27` (no `NEXT_PUBLIC_`); unused in code | Vacuously satisfied |
| TRK-7.4-01 | "Not endorsed by Riot Games" disclaimer | MISSING | `components/layout/site-footer.tsx`, `app/layout.tsx` | |
| TRK-7.4-02 | No invented MMR displayed | DONE | grep `mmr`: 0 hits | Vacuous |
| TRK-7.4-03 | Player opt-in (RSO) before showing data | SPEC-CONFLICT | n/f | Conflict 3 |
| TRK-7.5-01 | Valorant via ManualProvider; TFT later | DEFERRED | n/f | Phase 6 |
| TRK-7.6-01 | Scheduler/workers for polling | MISSING | n/f | |
| TRK-7.6-02 | Central token-bucket limiter per key/host, honors `Retry-After` | MISSING | n/f | |
| TRK-7.6-03 | Polling cadence by order state | MISSING | n/f | |
| TRK-7.6-04 | Match detail cached forever; `startTime` filter; dedupe | MISSING | n/f | |
| TRK-7.6-05 | `lp_delta` from consecutive snapshots | MISSING | n/f | |
| TRK-7.6-06 | Linear progress scale, Master+ by LP, clamped % | MISSING | n/f | |
| TRK-7.6-07 | TARGET_REACHED detection (+ bonus win) | MISSING | n/f | |
| TRK-7.6-08 | `played_by` attribution via booster sessions | MISSING | n/f | |
| TRK-7.6-09 | Anomaly alerts for support | MISSING | n/f | |
| TRK-7.7-01 | `RankProvider` interface + Riot/Manual/Mock implementations | MISSING | n/f | |
| TRK-7.8-01 | Data minimization + 90-day retention | MISSING | n/f | |

### 4.5 Technical design (spec 8)

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| TECH-8.1-01 | Next.js + TS + Postgres + ORM | DONE | `package.json`; `prisma/schema.prisma` | |
| TECH-8.1-02 | Redis / job queue | MISSING | `package.json` | |
| TECH-8.1-03 | Live updates via WS/SSE/hosted realtime | DONE | `lib/realtime/*`; `app/api/realtime/auth/route.ts` | Supabase Realtime |
| TECH-8.1-04 | Observability: Sentry + `audit_log` | MISSING | `lib/logger.ts` only | |
| TECH-8.2-01 | Single `transitionOrder(orderId, event, actor)` | PARTIAL | table `lib/assignments/types.ts` `ORDER_STATUS_TRANSITIONS`; 10 direct writes (C9) | |
| TECH-8.2-02 | Every transition writes `order_events` with actor | PARTIAL | `orderEvent.create` in each service fn | No `actor_id` column; actor only sometimes in `metadata`; customer create event written outside a tx (`app/api/orders/route.ts:61`) |
| TECH-8.2-03 | State set matches spec 8.2 | PARTIAL | `schema.prisma:135-141` | 5 of 11 states; see conflict 2 |
| TECH-8.2-04 | Transition table unit-tested, illegal transitions rejected | PARTIAL | `__tests__/assignments.service.test.ts:95` (passes under vmThreads) | Tests the table, not the writers |
| TECH-8.3-01 | `ledger_entries` double-entry with listed accounts | MISSING | n/f | |
| TECH-8.3-02 | All money as integer minor units + currency | PARTIAL | `schema.prisma:163-164` `Decimal(10,2)` | Wrong type; never written |
| TECH-8.3-03 | Balances derived from ledger sums | MISSING | n/f | |
| TECH-8.4-01 | Core schema tables | PARTIAL | present: users, oauth (`account`), sessions, orders, order_events, chat, notifications | Missing: guest_sessions, riot_accounts, order_credentials, order_sessions, rank_snapshots, tracked_matches, booster_applications (as table), booster_permissions, payout_methods, fines, ledger, payouts, payments, refunds, disputes, reviews, coupons, audit_log |
| TECH-8.4-02 | Migrations reflect schema | PARTIAL | C7 | 5 models unmigrated |
| TECH-8.5-01 | Envelope-encrypted credentials, reveal logged, auto-purge | MISSING | n/f | |
| TECH-8.5-02 | Prefer Duo; credentials only when needed | UNVERIFIED | no credentials collected at all | Product decision (spec 10.6) |
| TECH-8.5-03 | Rate limits on login, chat, claim, payout | PARTIAL | chat only (C10) | |
| TECH-8.5-04 | CSRF, strict CORS, CSP | PARTIAL | `next.config.ts` (no `headers()`); NextAuth CSRF covers its own routes only | No CSP; JSON APIs rely on same-site cookies |
| TECH-8.5-05 | Payout-method change: email confirm + cooldown | MISSING | n/f | |
| TECH-8.5-06 | Server-side role checks on every endpoint; scoped data | PARTIAL | section 5 | Gaps C4, C12, C17, C19 |
| TECH-8.5-07 | Never expose payout to customers / price to boosters | PARTIAL | C3 | Booster side fails |
| TECH-8.5-08 | Webhook signatures + idempotency keys | MISSING | n/f | |
| TECH-8.5-09 | GDPR export/delete, retention, cookie consent | MISSING | n/f | |
| TECH-8.6-01 | REST surface per spec 8.6 | PARTIAL | `app/api/**` (34 handlers) | Present: orders list/detail/create, chat, booster claim/release/complete/pause/resume, applications, admin applications. Missing: quote, payments webhook, matches, confirm/tip/dispute/review/credentials, earnings/payouts/fines, admin orders/disputes/fines/payouts/refunds/config, public boosters |
| TECH-8.7-01 | `riot.pollActiveOrders` | MISSING | n/f | |
| TECH-8.7-02 | `order.slaWatcher` | MISSING | n/f | |
| TECH-8.7-03 | `order.autoConfirm` | MISSING | n/f | |
| TECH-8.7-04 | `payout.processor` | MISSING | n/f | |
| TECH-8.7-05 | `payment.reconcile` | MISSING | n/f | |
| TECH-8.7-06 | `retention.purge` | MISSING | n/f | |
| TECH-8.7-07 | `notification.dispatcher` | PARTIAL | notifications created inline after transactions (`lib/notifications/service.ts:55`) | Synchronous; no retry/outbox; email absent |
| TECH-8.8-01 | Admin: applications queue | DONE | `app/dashboard/admin/applications/*`; `app/api/admin/boosters/**` | |
| TECH-8.8-02 | Admin: booster list/status/permissions | PARTIAL | `GET /api/admin/boosters` | No suspend, no permissions |
| TECH-8.8-03 | Admin: live orders board with SLA colors | MISSING | `app/dashboard/admin/page.tsx:47-50` "coming soon" | |
| TECH-8.8-04 | Admin: order detail with event log + chat | PARTIAL | `app/dashboard/[orderId]/page.tsx:35` (admin can view) | No reassign/refund controls |
| TECH-8.8-05 | Admin: disputes, refunds, fines, payouts, config, audit viewer | MISSING | n/f | Support-ticket admin exists (`app/dashboard/admin/support/*`) |

### 4.6 Phases (spec 9)

| ID | Phase | Status | Notes |
|---|---|---|---|
| PHASE-0 | Foundation: repo, Postgres, auth (email/Google/Discord/guest), roles, i18n, seed + price module | PARTIAL | Email + Google, single-role enum; no Discord/guest/i18n/seed/price; tests don't run by default |
| PHASE-1 | Customer ordering: form, quote, creation, fake PaymentProvider, webhook, order page, ledger on payment | PARTIAL | Form + creation + basic page; no quote/payment/ledger; C1 |
| PHASE-2 | Booster core: application/review, profile, pool, atomic claim, SLA, workspace, chat, sessions, completion | PARTIAL | All but SLA, sessions, public profile |
| PHASE-3 | Tracker (LoL) | MISSING | Only an orphaned routing test |
| PHASE-4 | Money completion | MISSING | |
| PHASE-5 | Trust and growth | DEFERRED | Notifications and support tickets exist early |
| PHASE-6 | Extensions | DEFERRED | |

### 4.7 Spec conflicts (spec, as flagged in the audit brief)

| ID | Conflict | Status |
|---|---|---|
| CONF-01 | Booster payout formula 5.7 vs 6.2 | SPEC-CONFLICT |
| CONF-02 | State machine gaps (PAID/OPEN merge, COMPLETED/CONFIRMED vs AVAILABLE, PAUSED→cancel, reassign event) | SPEC-CONFLICT |
| CONF-03 | Riot ID typed by customer vs opt-in/RSO | SPEC-CONFLICT |
| CONF-04 | Middle East server lacks a routing entry | SPEC-CONFLICT |
| CONF-05 | Mandatory booster 2FA vs Solo mode on 2FA-protected customer accounts | SPEC-CONFLICT |
| CONF-06 | Claim SQL checks status only | SPEC-CONFLICT |
| CONF-07 | Unspecified: tips ledger, moderation storage, dispute freeze, legal pages | SPEC-CONFLICT |

(Details and recommendations in section 7.)

### 4.8 Cross-cutting

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| QA-9-00 | Test suite runs green on every phase | PARTIAL | section 2.1 | Default pool fails; 6 failing + 5 broken files under vmThreads |
| QA-9-01 | Typecheck clean | PARTIAL | 37 tsc errors | 12 in source |
| QA-9-02 | Lint clean | PARTIAL | 167 errors / 121 warnings (source only) | Full-repo lint unusable due to `package/` |
| LEGAL-0.3-01 | Risk disclosure, ban/refund policy, legal pages | MISSING | no terms/privacy/refund routes under `app/` | Home FAQ says policies "will be shown" (`components/home/sections.tsx:20`) |

---

## 5. Route / guard table (check G)

"Session" = `getSessionUser()` (NextAuth JWT + DB lookup). "RL" = rate limit (all in-memory).

| Route | Methods | Guard | Ownership / scope | RL | Flags |
|---|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth | n/a | **No** | Credentials login unthrottled (C10) |
| `/api/auth/register` | POST | Public | n/a | **No** | No email verification |
| `/api/orders` | POST | Session | creates for self | **No** | **C1**: creates claimable unpaid order; ignores `allowOrder`/`orderCapability` |
| `/api/orders` | GET | Session | `userId = self` | No | Returns raw rows (fine today; re-check when payout fields exist) |
| `/api/orders/[orderId]` | GET | Session | owner only (`route.ts:12`) | No | Admin/booster cannot use it |
| `/api/orders/[orderId]/game-account` | PATCH | Session | owner only | No | Any status (C14) |
| `/api/orders/[orderId]/messages` | GET, POST | Session + `canAccessConversation` | customer / active booster / admin | POST 30/min | Suspended booster passes (C12); GET marks messages read as a side effect |
| `/api/orders/[orderId]/typing` | POST | Session + `canAccessConversation` | same | 120/min | |
| `/api/orders/draft` | POST | **None** | n/a | **No** | C19 |
| `/api/profile` | GET, PATCH | Session | self | No | |
| `/api/notifications` | GET | Session | self | No | |
| `/api/notifications/[id]` | PATCH | Session | owner check `route.ts:21` | No | |
| `/api/notifications/read-all` | POST | Session | self | No | |
| `/api/realtime/auth` | POST | `getRealtimeEligibleUser` + `canAccessChannel` | per channel policy | 30/min by `x-forwarded-for` | Spoofable key (C10); revocation advisory (C11) |
| `/api/support/tickets` | GET | Session | own tickets / admin all | No | |
| `/api/support/tickets` | POST | Session | self | 5/h | `orderId` not ownership-checked (C17); `ACCOUNT_ISSUE` → 500 (C20) |
| `/api/support/tickets/[ticketId]` | GET | Session | owner or admin | No | |
| `/api/support/tickets/[ticketId]` | PATCH | Session + `role === ADMIN` | n/a | No | |
| `/api/support/tickets/[ticketId]/messages` | POST | Session | owner or admin | 20/min | |
| `/api/booster/application` | GET | Session (any role) | self | No | |
| `/api/booster/apply` | POST | Session + `role === CUSTOMER` | self | **No** | |
| `/api/booster/profile` | PATCH | Session + BOOSTER + APPROVED | self | No | `languages` unvalidated |
| `/api/booster/welcome-modal/seen` | POST | `requireBooster` | self | No | |
| `/api/booster/orders/available` | GET | Session + BOOSTER + `verifyBoosterEligibility` | none (pool) | No | **C3** leakage |
| `/api/booster/orders/claimed` | GET | Session + BOOSTER (no status check) | own assignments | No | **C4** leakage; suspended boosters allowed |
| `/api/booster/orders/[orderId]/claim` | POST | Session + BOOSTER + eligibility | n/a | **No** | No permissions/concurrency cap |
| `/api/booster/orders/[orderId]/release` | POST | Session + BOOSTER/ADMIN; service ownership | `assertAssignmentAccess` | No | C16 order-id check after mutation |
| `/api/booster/orders/[orderId]/pause` | POST | same | same | No | C16 |
| `/api/booster/orders/[orderId]/resume` | POST | same | same | No | C16 |
| `/api/booster/orders/[orderId]/complete` | POST | same | same | No | C16; no customer confirm step |
| `/api/booster/orders/[orderId]/cancel` | POST | same | same | No | **C5** booster cancels customer order; C16 |
| `/api/booster/orders/[orderId]/accept` | POST | Session + BOOSTER; service ownership | `orderId` ignored | No | Legacy (ASSIGNED flow no longer created) |
| `/api/booster/orders/[orderId]/decline` | POST | same | `orderId` ignored | No | Legacy |
| `/api/booster/orders/[orderId]/start` | POST | same | `orderId` ignored | No | Legacy; order update has no status guard |
| `/api/admin/boosters` | GET | `requireAdmin` (throws) | all | No | Returns full `applicationData` (PII) to admins, acceptable |
| `/api/admin/boosters/[userId]/approve` | POST | `requireAdmin`; self-review blocked | conditional on PENDING | No | Overwrites role (C6); no audit log |
| `/api/admin/boosters/[userId]/reject` | POST | `requireAdmin`; self-review blocked | conditional on PENDING | No | |

Page-level guards: `app/dashboard/[orderId]/page.tsx:29-55` (admin any order; booster only with active assignment; customer only own); booster pages redirect non-APPROVED boosters (e.g. `app/dashboard/booster/available-orders/page.tsx:51-60`); admin pages redirect non-admins (`app/dashboard/admin/page.tsx:17-46`). There is no `middleware.ts`/`proxy.ts`; every page guards itself.

---

## 6. Acceptance test matrix (check J)

| # | Acceptance test (spec 9) | Test exists? | Passes? | Tests the stated behavior? |
|---|---|---|---|---|
| AT-01 | Two concurrent claims → exactly one succeeds | Yes: `__tests__/assignments.service.test.ts:258` "concurrent claims" | **No** (0 fulfilled; mock lacks `assignedAt`) | **No.** Prisma is mocked, so the second claim's failure is scripted (`throw p2002()`). The real guarantee comes from DB constraints that are never exercised. Needs an integration test against Postgres |
| AT-02 | No contact in 5 min → warning; no start in 60 min → auto-release, strike, credentials revoked | No | n/a | Feature missing |
| AT-03 | Webhook replay doesn't double-credit or double-open | No | n/a | Feature missing |
| AT-04 | Customer never sees payout; booster never sees price/credentials before claim | No | n/a | Would **fail** today (C3) |
| AT-05 | Pro-rata payout on abandon matches a table | No | n/a | Feature missing |
| AT-06 | Ledger balances; balance = sum; fines reduce it | No | n/a | Feature missing |
| AT-07 | Tracker progress/LP delta/promo/demo/target incl. Master+ | No (routing test only, and it fails to import) | n/a | Feature missing |
| AT-08 | Riot rate limiter never exceeds limits; 429 → backoff | No (`security/rate-limit.test.ts` targets the chat limiter and does not compile) | n/a | Feature missing |
| AT-09 | State machine rejects illegal transitions | Partial: `assignments.service.test.ts:95` (table), "cannot pause an already-paused assignment" | Yes (under vmThreads) | **Partly.** Tests the table and one guard; release/abandon/start/reassign bypass the table |
| AT-10 | Credentials encrypted, reveals logged, purged after retention | No | n/a | Feature missing |

---

## 7. Spec conflicts: current code behavior and recommended resolution

**1. Booster payout: 5.7 `base_payout_for_service(...)` vs 6.2 `total_before_discount * (1 - platform_fee)`.**
*Code:* neither; no payout field. *Recommend:* one function, `computeBoosterPayout(quote)`, called once at order creation and stored in minor units on the order. Implement it as 6.2's formula on the **pre-discount** list price with a per-service `platform_fee_bps`, so discounts and coupons are absorbed by the platform and never reduce booster pay. Treat 5.7's `base_payout_for_service` as the name of that function, not a second pricing table. Re-pricing on release (5.5) recomputes only the remainder.

**2. State machine.**
*Code:* 5 states. `PENDING` merges PENDING_PAYMENT and OPEN; `IN_PROGRESS` merges CLAIMED and IN_PROGRESS; no TARGET_REACHED/CONFIRMED/REFUNDED/DISPUTED. PAUSED→CANCELLED is allowed (`types.ts` table), but only boosters can trigger it. Admin reassign exists as a service fn that writes status directly. *Recommend:* order enum `PENDING_PAYMENT, OPEN, CLAIMED, IN_PROGRESS, PAUSED, TARGET_REACHED, COMPLETED, CONFIRMED, CANCELLED, REFUNDED, DISPUTED`. Keep "earning state" off the order: it lives on the ledger, and the `CONFIRMED` transition (customer or auto-confirm) is the single event that posts `booster_pending → booster_available`. Add `PAUSED → CANCELLED` via support with a partial refund, and an explicit `REASSIGN` event (support only) `CLAIMED|IN_PROGRESS|PAUSED → CLAIMED` with a new booster and fresh SLA deadlines. Route everything through `transitionOrder`.

**3. Riot data without opt-in.**
*Code:* the customer types a Riot ID; nothing is fetched, so nothing is shown. *Recommend:* start on `ManualProvider`. When enabling `RiotApiProvider`, show tracked data only to the account owner (the customer) and the parties working the order (assigned booster, support), behind an explicit consent checkbox at order time, and add RSO verification once a production key exists. Never show it publicly or to unassigned boosters. If Riot declines the use case, stay on ManualProvider (the spec 7.7 fallback).

**4. Middle East platform missing from the routing map.**
*Code:* no server field is captured at all, and the routing module is missing. *Recommend:* derive the order form's server list *from* the routing table so they cannot drift. Confirm the Middle East platform ID and its regional cluster against Riot's current routing docs before enabling it. Until then, hide it or mark it ManualProvider-only.

**5. Mandatory booster 2FA vs Solo mode on customer accounts with 2FA.**
*Code:* no 2FA of any kind. *Recommend:* these are separate concerns. Booster 2FA protects the *platform* account and should be mandatory. For Solo orders on customer game accounts that have 2FA, don't design around it and don't ask customers to disable it: either default to Duo (spec 10.6), or require the customer to approve logins themselves. This is a product/policy decision for you (see FIX_PLAN "Decisions").

**6. Claim atomicity: the spec SQL checks only status.**
*Code:* stronger than the spec for the race (unique `activeOrderId` + check constraint + conditional update), but the permission, concurrency-cap, and preferred-booster rules don't exist, and eligibility is read outside the transaction. *Recommend:* inside one transaction, (a) `SELECT ... FOR UPDATE` the booster row, (b) re-check status APPROVED, permissions, and active count < cap, (c) conditional `UPDATE orders ... WHERE status='OPEN' AND (preferred_booster_id IS NULL OR preferred_booster_id=$b OR preferred_until < now())`, (d) assert 1 row. Keep the DB unique constraint as the backstop.

**7. Not covered by the spec.**
*Code:* none of these exist. *Recommend:*
- **Tips:** a separate ledger entry pair, `customer_payment → booster_available`. Default: no platform fee, processor fee passed through (DECISION). Never routed through `escrow`.
- **Chat moderation storage:** store the original message plus `flags[]`, show a masked version to the recipient, and the original plus flags to support. Never silently drop content.
- **Dispute freeze:** opening a dispute moves the order's `booster_pending` amount to a `held` account (or sets an earning hold flag that blocks `AVAILABLE`). Resolution posts to `booster_available` or `refunds`.
- **Legal/risk pages:** Terms, Privacy, Refund & Cancellation, Ban-risk disclosure, and the Riot disclaimer. These are required before checkout goes live (spec 0.3).
