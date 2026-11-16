# LegendsBoost: Fix Plan

Companion to `AUDIT_REPORT.md` (finding IDs `C*` and requirement IDs refer to it). Sizes: **S** ≈ under half a day, **M** ≈ 1-3 days, **L** ≈ about a week. Every item names the test that proves it done. No item touches catalog/service creation beyond the seed file and price function, and nothing here concerns Riot detection or enforcement.

---

## 1. Fix now (existing code that is wrong or unproven, by severity)

| ID | Sev | Fix | Files likely touched | Size | Depends on | Proof (test) |
|---|---|---|---|---|---|---|
| F-01 | Blocker | **Keep unpaid orders out of the pool (C1).** Add `PENDING_PAYMENT` to `OrderStatus` (additive migration) and create orders in it. Reject `POST /api/orders` unless the offer has `allowOrder === true` and `orderCapability === 'live-order'`. The pool and `claimOrder` keep accepting only the paid/open status. The full enum rename comes with F-07 | `prisma/schema.prisma`, new migration, `app/api/orders/route.ts`, `lib/orders/statuses.ts`, `lib/orders/status-display.ts`, `components/dashboard/customer/StatusBadge.tsx` | S | none | Integration: an order created via `POST /api/orders` is absent from `getAvailableOrders()`, and `claimOrder` on it throws `OrderNotClaimableError`. Unit: draft-only offer → 403 |
| F-02 | High | **Make the test suite run (C8, QA-9-00).** Find why the default `forks`/`threads` pools fail on Windows + Vitest 5. If no fix is found, set `pool: 'vmThreads'` and give the crypto/stream tests `// @vitest-environment node`. Build the alias with `fileURLToPath`. Repair drifted tests: `assignedAt` in the claim mocks, the `pauseAssignment` return shape, `rate-limit.test.ts` imports, convert `auth/password.test.ts` to Vitest, `it.skip` the Riot routing test until B3-1. Add a Postgres integration harness (local Docker or a Supabase branch) | `vitest.config.ts`, `__tests__/**`, new `__tests__/integration/setup.ts` | M | none | `npx vitest run` exits 0 with the repo config. New **AT-01 integration test**: 2 to 10 parallel `claimOrder` calls against real Postgres, exactly 1 fulfilled |
| F-03 | High | **Booster-facing DTOs (C3, C4).** Add explicit `select` serializers: the pool card gets service, rank path, server, queue, mode, extras, `boosterPayout` (once it exists), and age. Never `price`, `currency`, `user`, or Riot ID. The workspace hides "Total" for boosters. History returns a summary only (no `configuration`) | new `lib/orders/dto.ts`, `lib/assignments/service.ts:74-136`, `app/api/booster/orders/available/route.ts`, `app/api/booster/orders/claimed/route.ts`, `app/dashboard/booster/available-orders/page.tsx`, `app/dashboard/[orderId]/page.tsx`, `components/orders/workspace/OrderWorkspace.tsx` | S-M | none | **AT-04**: key-allowlist tests on each DTO, plus a route test asserting `price`, `currency`, `user`, `riotGameName` are absent from both booster responses |
| F-04 | High | **Boosters release, they don't cancel (C5).** Remove the booster cancel route and button. Order cancellation becomes customer (OPEN/CLAIMED) and support only, wired to the refund matrix in Phase 4 | `app/api/booster/orders/[orderId]/cancel/route.ts`, `lib/assignments/service.ts:541-640`, `app/dashboard/booster/orders/[orderId]/OrderActions.tsx` | S | none | Route test: booster `POST .../cancel` → 404/403 and order status unchanged |
| F-05 | High | **Role flags (C6, ROLE-4.1-06).** Replace `role UserRole?` with `roles UserRole[]` and backfill. Change `hasRole` and guards to membership checks, carry `roles` in the JWT, add a role switcher in the dashboard, and make the order page pick its branch by relationship to the order (owner / assigned booster / staff), not by a single role. Approval *adds* BOOSTER. Add a `SUPPORT` role | `prisma/schema.prisma`, migration, `auth.ts`, `types/next-auth.d.ts`, `lib/auth/*`, `lib/dashboard/*`, `app/dashboard/**`, `app/api/**` (every `user.role ===`), approve route | L | F-02 | Integration: user approved as booster can still open their own customer order **and** claim an order. Unit: guard matrix per role combination |
| F-06 | High | **Migration drift (C7).** Generate the missing migration with `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma`. Baseline any environment where the tables were created via `db push` (`migrate resolve --applied`). Add `prisma/seed.ts` or drop the `seed` entry | `prisma/migrations/*`, `prisma.config.ts` | S | none | CI step: fresh DB → `prisma migrate deploy` → `prisma migrate diff --exit-code` reports no difference |
| F-07 | Medium | **Single `transitionOrder` (C9, TECH-8.2-01..04).** Build an event-based transition table (spec 8.2 plus the CONF-02 resolution) and one function that does a conditional update on `from` status, writes `order_events` with `actor_id` in the same transaction, and returns the result. Notifications and broadcasts dispatch after commit. Refactor the 10 writers; delete legacy accept/decline/start routes and functions | new `lib/orders/state-machine.ts`, `lib/assignments/service.ts`, `lib/assignments/types.ts`, `app/api/booster/orders/[orderId]/{accept,decline,start}/route.ts`, schema (`orderEvent.actorId`) | M | F-01, decision D-2 | **AT-09**: table-driven test over every (state, event) pair. Lint/grep CI check forbids `order.update(` with `status` outside the state machine |
| F-08 | Medium | **Real rate limiting (C10).** One limiter backed by Postgres or Upstash Redis, keyed on the platform client IP (not raw `x-forwarded-for`) plus user/email. Apply to credentials login, register, claim, apply, chat, tickets. Delete the duplicate in `lib/security/sanitize.ts` | `lib/rate-limit.ts`, `lib/security/sanitize.ts`, `auth.ts`, `app/api/auth/register/route.ts`, claim/apply/messages/tickets routes | M | none | Test: N+1th login attempt in the window → 429 even when two limiter instances share the store |
| F-09 | Medium | **Enforce Realtime revocation server-side (C11).** Commit the Supabase Realtime RLS policies to the repo (SQL migration) so they re-check order access from DB state, or cut the token TTL to ~60s with client refresh. Today this is UNVERIFIED | `supabase/` or `prisma/migrations` SQL, `lib/supabase/realtime-auth.ts:24` | M | none | Integration: after `releaseAssignment`, the former booster's existing token can no longer receive `private-order:{id}` messages |
| F-10 | Medium | **Suspended boosters lose order access (C12).** Add one `canAccessOrder(user, orderId)` that checks booster `verificationStatus` and use it in chat routes, the order page, typing, and the claimed list | `lib/chat/service.ts`, new `lib/orders/access.ts`, `app/api/orders/[orderId]/{messages,typing}/route.ts`, `app/dashboard/[orderId]/page.tsx`, `app/api/booster/orders/claimed/route.ts` | S | none | Test: SUSPENDED booster with an active assignment gets 403 on messages GET/POST and 404 on the page |
| F-11 | Medium | **Chat anonymity and moderation (C13, BOOST-5.8-02/03).** Show booster display name / "Customer" instead of `User.name`. Add a pattern filter (email, phone, Discord handle, PayPal) that stores the original + `flags`, shows a masked version to the recipient, and alerts support | `lib/chat/service.ts`, schema (`orderMessage.flags`, booster `displayName`), `components/chat/OrderChat.tsx` | M | decision D-12 | Unit: table of messages → expected flags/masking. Route test: broadcast payload has no real name |
| F-12 | Medium | **Lock the Riot ID once claimed (C14).** Move it to a `riot_accounts` row (gameName, tagLine required, platform), editable only before CLAIMED (support can override) | `app/api/orders/[orderId]/game-account/route.ts`, schema, `OrderWorkspace.tsx` | S-M | F-07 | Route test: PATCH on IN_PROGRESS → 409 |
| F-13 | Medium | **Wrong event semantics (C15).** Cancel sends the cancellation notification type; complete broadcasts `newStatus: COMPLETED` | `lib/assignments/service.ts:525-536,607-612` | S | none (absorbed by F-07 if done together) | Unit: assert notification type and broadcast payload per action |
| F-14 | Low | Pass `orderId` into service functions and assert it inside the transaction **before** mutating (C16) | 5 booster routes, `lib/assignments/service.ts` | S | none | Test: mismatched `orderId` → 403, assignment unchanged |
| F-15 | Low | Ownership check on `orderId` when creating support tickets (C17) | `lib/support/service.ts:26-60` | S | none | Test: ticket for another customer's order → 400 |
| F-16 | Low | Move the eligibility check into the claim transaction (C18). Lands naturally in B2-1 | `lib/assignments/service.ts:170-214` | S | B2-1 | Covered by the B2-1 tests |
| F-17 | Low | `/api/orders/draft`: require auth and rate-limit, or delete it together with the in-memory store (C19) | `app/api/orders/draft/route.ts`, `lib/orders/draft-store.ts` | S | none | Route test: unauthenticated → 401 |
| F-18 | Low | Align support categories (add `ACCOUNT_ISSUE` to the enum, or drop it from the API and UI) and import the `User` icon (C20) | `prisma/schema.prisma`, `app/api/support/tickets/route.ts`, `lib/support/service.ts`, `components/support/SupportTicketList.tsx` | S | F-06 | tsc clean; route test for each category |
| F-19 | Low | Payment page reads `data.order`; hide the page until B1-4 lands (C21) | `components/payment/PaymentPageClient.tsx` | S | none | Component test renders summary for an existing order |
| F-20 | Low | **Static hygiene.** Fix 12 source tsc errors; fix `rules-of-hooks` (`faq-accordion.tsx:33`), `jsx-no-undef`, 3x `immutability`. Add `package/**` to ESLint ignores and tsconfig `exclude`, and confirm whether the untracked `package/` directory (a vendored `next` tarball) should exist at all. Remove `x.txt`, `schema.prisma.tmp`, empty `__tests/` | `eslint.config.mjs`, `tsconfig.json`, listed source files | S | none | `npx tsc --noEmit` = 0 errors; `npx eslint .` finishes with 0 errors (downgrade `no-explicit-any` to warn if you prefer) |

---

## 2. Build next (missing work, grouped by spec phase)

### Phase 0: Foundation
| ID | Item | Files likely touched | Size | Depends on | Proof |
|---|---|---|---|---|---|
| B0-1 | Role flags + SUPPORT role (= F-05) | see F-05 | L | F-02 | see F-05 |
| B0-2 | Discord OAuth | `auth.ts`, `.env.example`, login UI | S | none | Provider config test; manual sign-in |
| B0-3 | Guest checkout + signed magic-link order access (`guest_sessions`) | schema, `app/api/auth/guest`, order access helper | M | F-05 | Guest can view only their order via link; expired/forged token → 401 |
| B0-4 | Email verification code + password reset / forced reset | schema (`verificationToken` reuse), routes, email adapter (Resend/Postmark) | M | email provider | Unverified user blocked from checkout; reset token single-use |
| B0-5 | TOTP 2FA: optional for customers, enforced for BOOSTER/SUPPORT/ADMIN | schema (`twoFactorSecret` encrypted), auth callbacks, UI | M | F-05 | Booster session without 2FA cannot reach booster routes |
| B0-6 | i18n scaffold (next-intl, EN + FR), currency preference | `app/[locale]`, messages files | M | none | Snapshot test renders FR strings |
| B0-7 | `catalog.seed.json` (LoL Solo/Duo rank boost) + **pure price module** reading it (additive extras, LP adjustment, region multiplier, discount cap, `boosterPayout`, ETA) | `catalog/catalog.seed.json`, `lib/pricing/*`, `__tests__/pricing/*` | M | D-1 | Table-driven unit tests; property test: total ≥ 0, payout ≤ pre-discount total |
| B0-8 | `audit_log` table + `audit()` helper | schema, `lib/audit.ts` | S | none | Approve/reject/reassign write audit rows |
| B0-9 | Legal pages, ban-risk disclosure, Riot "not endorsed" disclaimer in footer | `app/(legal)/*`, `components/layout/site-footer.tsx` | S | D-7 | Footer render test contains the disclaimer |

### Phase 1: Customer ordering + money foundation
| ID | Item | Files likely touched | Size | Depends on | Proof |
|---|---|---|---|---|---|
| B1-1 | Full order state enum + `transitionOrder` (= F-07) | see F-07 | M | D-2 | AT-09 |
| B1-2 | Money in integer minor units: `priceMinor`, `platformFeeMinor`, `boosterPayoutMinor`, `currency` (required), written at creation from B0-7 | schema, `app/api/orders/route.ts` | S | B0-7 | Creation test stores exact minor-unit values from the price module |
| B1-3 | `POST /api/orders/quote` + server-side config validation (desired > current, Flex-only multi-booster, Master cap, duo rules, server/queue required) | `app/api/orders/quote`, `lib/pricing/validate.ts` | M | B0-7 | Validation table tests; quote response for customers contains no payout fields |
| B1-4 | `PaymentProvider` interface + `FakePaymentProvider` | `lib/payments/*` | M | B1-1 | Fake checkout drives PENDING_PAYMENT → OPEN only via webhook |
| B1-5 | `POST /api/payments/webhook/[provider]`: signature verify, `payments` + `webhook_events (provider, event_id) UNIQUE`, idempotent transition | route, schema | M | B1-4, B1-6 | **AT-03**: replaying the same event 3x → one ledger posting, one OPEN transition |
| B1-6 | `ledger_entries` + `postLedger(tx, entries[])` asserting Σ = 0 per currency; accounts per spec 8.3 (+ `held`, `tips`) | schema, `lib/ledger/*` | L | B1-2 | **AT-06** (part 1): every posting balanced; balance = Σ entries; DB CHECK/trigger rejects unbalanced batches |
| B1-7 | Ban-risk checkbox stored on the order | checkout UI, schema | S | B0-9 | Order cannot leave PENDING_PAYMENT without consent flag |
| B1-8 | Order page header: rank path, server, queue, ETA (render the unused `currentRank`/`targetRank`) | `OrderWorkspace.tsx`, `app/dashboard/[orderId]/page.tsx` | S | B1-3 | Component test |

### Phase 2: Booster core
| ID | Item | Files likely touched | Size | Depends on | Proof |
|---|---|---|---|---|---|
| B2-1 | Claim rewrite in one transaction: lock booster row, re-check APPROVED, `booster_permissions` (game/tier/region/kind), active-order cap (default 3), preferred-booster window, conditional update, 1-row assert | `lib/assignments/service.ts`, schema | M | B1-1, B2-2 | Integration: cap, permission, and preferred-window cases plus AT-01 |
| B2-2 | `booster_permissions` table + admin editor | schema, admin UI/API | M | F-05 | Booster approved to Diamond cannot claim Master |
| B2-3 | CLAIMED state, `contact_deadline`/`start_deadline`, **scheduler** (Vercel Cron → route with `pg_try_advisory_lock`, or pg-boss) and `order.slaWatcher` (warn, then auto-release + strike + credential revoke) | schema, `app/api/jobs/*`, `lib/jobs/*`, `vercel.json` | L | B2-1, D-13 | **AT-02** with a fake clock: no contact @5 min → warning; no start @60 min → OPEN + strike + revoke event |
| B2-4 | Strikes, suspend/terminate actions, 3-in-30-days auto-suspend, TRIAL state + counter | schema, admin API, service | M | B2-3 | Threshold test; suspended booster blocked everywhere (F-10) |
| B2-5 | Release rules: 10-min grace, mandatory reason after, `priority=true` on reopen | service, release route | S | B2-4 | Unit tests per window |
| B2-6 | `order_sessions` start/end + progress notes → activity feed | schema, routes, workspace UI | M | B1-1 | Session window test; notes appear in customer feed |
| B2-7 | Booster display name + public profile pages `/boosters`, `/boosters/[id]` | schema, `app/boosters/*` | M | F-11 | Public DTO excludes private fields |
| B2-8 | Customer controls: pause/resume, cancel (OPEN/CLAIMED self-serve) | `app/api/orders/[orderId]/{pause,resume,cancel}` | M | B1-1 | Route tests per state |
| B2-9 | Completion → customer confirm (and the auto-confirm hook for B4-2) | routes, UI | S | B1-1 | COMPLETED → CONFIRMED only by customer/support/job |
| B2-10 | Credentials vault (only if Solo launches, D-6): envelope encryption (KMS DEK/KEK), reveal endpoint for the assigned booster in CLAIMED/IN_PROGRESS/PAUSED, audit row per reveal, revoke on release/suspend, purge after completion + grace | schema (`order_credentials`), `lib/crypto/*`, routes, `retention.purge` | L | B0-8, B2-3 | **AT-10**: ciphertext at rest, reveal logged, revoked booster denied, purge job deletes |

### Phase 3: Tracker (LoL)
| ID | Item | Files likely touched | Size | Depends on | Proof |
|---|---|---|---|---|---|
| B3-1 | `lib/riot/lol/routing.ts` (platform ↔ regional/account cluster); the test already exists | `lib/riot/lol/routing.ts` | S | D-4 | Un-skip `__tests__/riot/routing.test.ts` |
| B3-2 | `RankProvider` interface + `MockProvider` + `ManualProvider` (booster-submitted values, support verification) | `lib/tracker/*` | M | B1-1 | Order logic tests run against Mock only |
| B3-3 | `RiotApiProvider` (Account-V1, League-V4 by-puuid, Match-V5 ids/detail), server-only key | `lib/riot/*` | M | B3-1, B3-4 | Contract tests with recorded fixtures |
| B3-4 | Central token-bucket limiter per key and host, shared store, honors `Retry-After`, request dedupe | `lib/riot/limiter.ts` | M | F-08 store | **AT-08**: simulated 500 orders never exceed 20/s and 100/2 min; 429 → backoff respected |
| B3-5 | `riot_accounts` + PUUID resolution and periodic Riot ID refresh | schema, service | S | F-12 | Name change keeps the same PUUID mapping |
| B3-6 | `rank_snapshots`, `tracked_matches` (immutable cache), `riot.pollActiveOrders` with state-based cadence | schema, `lib/jobs/poll.ts` | L | B2-3 scheduler, B3-3 | Poll job is idempotent across re-runs |
| B3-7 | Pure progress module: linear points scale, Master+ by LP, `lp_delta` from snapshot pairs, clamp, TARGET_REACHED with bonus-win rule | `lib/tracker/progress.ts` | M | B3-2 | **AT-07** table incl. promotion, demotion, Master+, bonus win |
| B3-8 | Live rank card, progress bar, match history UI (booster vs customer via sessions) | workspace components | M | B3-6, B2-6 | Component tests; no MMR wording anywhere |
| B3-9 | Auto-detect "started" (first ranked game after claim) feeding the SLA | `lib/jobs/*` | S | B2-3, B3-6 | SLA test variant using tracker signal |
| B3-10 | Anomaly flags (game while PAUSED, game outside a session, winrate drop) as support alerts only | `lib/tracker/anomalies.ts` | M | B3-6 | Unit tests per rule; no automatic penalties |
| B3-11 | `retention.purge` for tracked data (default 90 days) | `lib/jobs/retention.ts` | S | B2-3 | Job deletes rows older than the retention window |

### Phase 4: Money completion
| ID | Item | Files likely touched | Size | Depends on | Proof |
|---|---|---|---|---|---|
| B4-1 | Earnings derived from the ledger (PENDING/AVAILABLE/PAID_OUT/CLAWED_BACK) + booster earnings UI | `lib/ledger/views.ts`, `app/dashboard/booster/cashout` | M | B1-6 | Balance equals Σ entries for random sequences |
| B4-2 | `order.autoConfirm` job (default 24h, skipped if disputed) | `lib/jobs/*` | S | B2-9, B2-3 | Fake-clock test |
| B4-3 | Payout methods (encrypted), email confirm, 48h change cooldown | schema, routes | M | B0-4, B2-10 crypto | Cooldown test |
| B4-4 | Payout requests (min threshold, ≤ available, `Idempotency-Key`), admin approval, `payout.processor`, FAILED → funds return | schema, routes, job, admin UI | L | B4-1, B4-3 | Double-submit → one payout; FAILED restores AVAILABLE |
| B4-5 | Fines: schedule seed, admin fine tool, ledger deduction, rules & fines screen, appeals flag | schema, routes, UI | M | B1-6, B2-4 | **AT-06** (part 2): fine reduces available balance by exactly its amount |
| B4-6 | Pro-rata payout on release using tracker or manual progress; re-price remainder | `lib/pricing/prorata.ts`, service | M | B3-7, B1-6 | **AT-05** table of progress cases |
| B4-7 | Refund matrix + clawback postings | `lib/refunds/*`, routes | M | B1-6, B1-1 | One test per state row in spec 6.5 |
| B4-8 | Disputes with evidence upload (S3-compatible), payout freeze (`held` account), resolution actions, audit | schema, routes, admin UI, storage | L | B4-7, B0-8 | Frozen funds cannot be paid out; each resolution posts balanced entries |
| B4-9 | Admin screens: live orders board with SLA colors, reassign (support), refunds, fines, payouts, config (fees, SLA minutes, thresholds) | `app/dashboard/admin/*` | L | above | E2E smoke per screen |
| B4-10 | `payment.reconcile` job | `lib/jobs/*` | S | B1-5 | Missing webhook recovered from provider state |

### Phase 5: Trust and growth (deferred)
Reviews (one per CONFIRMED order, tags, hide) · tips (D-11 ledger rule) · email notifications + outbox-based `notification.dispatcher` · KYC gate before first payout · real payment providers (D-4) · loyalty/coupons/wallet · audit-log viewer.

### Phase 6: Extensions (deferred)
TFT via the same tracker · Valorant via ManualProvider · coaching service type.

---

## 3. Decisions needed from you

Defaults are what I'd implement if you have no preference.

| ID | Decision | Source | Recommended default |
|---|---|---|---|
| D-1 | Platform fee per service | spec 10.1, CONF-01 | 25% on pre-discount list price; discounts absorbed by the platform; one `computeBoosterPayout()` stored at creation |
| D-2 | Final order state set | CONF-02 | `PENDING_PAYMENT, OPEN, CLAIMED, IN_PROGRESS, PAUSED, TARGET_REACHED, COMPLETED, CONFIRMED, CANCELLED, REFUNDED, DISPUTED`; earning state lives on the ledger; support-only `REASSIGN`; `PAUSED → CANCELLED` via support with partial refund |
| D-3 | Auto-confirm window | spec 10.2 | 24h |
| D-4 | Payment processor strategy | spec 10.4 | Ship `FakePaymentProvider` first; choose the real processor before Phase 5 with written confirmation it accepts this merchant category |
| D-5 | Riot production key now, or ManualProvider first | spec 10.5, CONF-03 | ManualProvider + Mock first; apply for a key in parallel; tracked data visible only to customer, assigned booster, and support, with explicit consent |
| D-6 | Solo (credential sharing) at launch, or Duo only | spec 10.6, CONF-05 | Duo only at launch; defer the credentials vault (B2-10) |
| D-7 | Risk-disclosure wording and ban policy | spec 10.7 | You provide the wording; legal review recommended |
| D-8 | Hosting region / data residency | spec 10.8 | EU region for DB and storage if EU customers are primary |
| D-9 | Fine amounts and strike thresholds | spec 10.3 | Spec placeholders: 3 strikes / 30 days → auto-suspend pending review |
| D-10 | Middle East server | CONF-04 | Hidden until its Riot platform/region routing is confirmed; derive the server list from the routing table |
| D-11 | Tips accounting | CONF-07 | `customer_payment → booster_available`, no platform fee, processor fee passed through |
| D-12 | Chat moderation storage | CONF-07 | Store original + flags; masked to recipient; original visible to support |
| D-13 | Scheduler/queue | spec 8.1/8.7 | Vercel Cron → job routes guarded by a secret + Postgres advisory locks (no Redis needed yet); move to pg-boss if job volume grows |
| D-14 | Keep `bcrypt` or move to `argon2` | spec 8.1 | Keep bcrypt-12 (already safe, with the 72-byte guard) |
| D-15 | What `package/` is | audit | Looks like an accidentally extracted `next` tarball (untracked). Confirm before I delete or ignore it |

---

## 4. Recommended execution order

Each step ends with the app running, `npx vitest run` green, `tsc` clean, and the step's new tests added.

1. **Stabilize the harness:** F-02, F-20, F-06. Nothing else is trustworthy until tests run and migrations match the schema.
2. **Stop the bleeding (small, independent):** F-01, F-03, F-04, F-13, F-14, F-15, F-17, F-18, F-19, F-10.
3. **Core model changes (need D-2):** F-07 (state machine), then F-05 (role flags). Both touch many call sites, so do them before adding features.
4. **Phase 0 remainder:** B0-7 (price module), B0-8, B0-9, then B0-2..B0-6 as needed.
5. **Phase 1 money foundation:** B1-2 → B1-6 (ledger) → B1-4 → B1-5 → B1-3 → B1-7 → B1-8. AT-03 and AT-06 (part 1) land here.
6. **Phase 2:** B2-2 → B2-1 (claim rewrite, AT-01 with permissions) → B2-3 (scheduler + SLA, AT-02) → B2-4/5/6/8/9 → B2-7 → B2-10 only if D-6 = Solo. Fold in F-08, F-09, F-11, F-12, F-16.
7. **Phase 3:** B3-1 → B3-2 → B3-7 (AT-07 on Mock data) → B3-4 (AT-08) → B3-3 → B3-5 → B3-6 → B3-8/9/10/11.
8. **Phase 4:** B4-1 → B4-2 → B4-5 → B4-6 (AT-05) → B4-7 → B4-3 → B4-4 → B4-8 → B4-10 → B4-9.
9. **Phase 5, then Phase 6.**
