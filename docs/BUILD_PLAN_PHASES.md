# BUILD PLAN: phases adapted to the existing LegendsBoost app

**Adapted:** 2026-11-14 from `docs/specs/BUILD_PLAN_PHASES.original.md`.
**Source specs:** `docs/specs/BOOSTING_PLATFORM_SPEC.md` (present). `BOOSTER_ROLE_SYSTEMS.md` (booster modules B1–B20, bidding and rank ceiling) is **missing**; add it to `docs/specs/` before Phase 3.

The original plan builds a new app from scratch. LegendsBoost already runs a large part of it, so here:
- **Phase 0 is an audit** of the existing app against every plan item. The results are recorded below.
- Phases 1–10 keep their goals but **only list what is missing**. Already-built functions are extended, never rewritten.
- File paths, status names and the stack follow the existing code, not the original's `/src` layout.

---

## 0. Rules for every session (adapted)

1. **One phase at a time.** Do not start phase N+1 until phase N's "Definition of done" passes.
2. **Read first:** this file, the relevant spec sections, and the files named in each phase.
3. **Pure logic first, tested first.** Rank math, pricing, award selection, SLA math, ledger posting and progress math are pure functions with unit tests before any UI.
4. **No direct status writes.** Order status changes go through `transitionOrder()` (to be created in Phase 0, see A-7). Booster status changes go through `transitionBooster()` (Phase 2).
5. **Money is integer minor units plus a currency.** It already is (`lib/money`). Balances are sums of ledger rows (`FinancialTransaction`); never add a balance column.
6. **Authorization is server-side.** It already is: `lib/orders/workspace-access.ts` and route guards. Hiding something in the UI is never the protection.
7. **The customer price is never shown to boosters, and booster payouts and ledger are never shown to customers.**
8. **External services sit behind interfaces:** `PaymentProvider` (Stripe exists), `RankProvider`, `KycProvider`, `Mailer`, `Notifier`, `Storage`. Ship a fake first.
9. **Every schema change is a migration in `prisma/migrations/`.** Never run `db push`. Apply only with the owner's OK.
10. **Evolving functions:** when you touch a function in the registry (section 2), update its row and add a line to `docs/CHANGELOG.md`. Extend it and keep its tests green.
11. **Every phase ends with:** `npx vitest run` green, `npx tsc --noEmit` clean, lint clean on changed files, the dev server tried, a CHANGELOG entry and the registry updated.
12. **Do not build:** account selling, lootboxes, anything that evades Riot detection, or "ban-safe" marketing claims (see `reports/Game boosting competitor features.md`).
13. **[DECISION] items become config values** (section 3), not constants.

### Actual stack (replaces the original's "Default stack")
| Concern | Original plan | LegendsBoost today | Decision |
|---|---|---|---|
| Framework | Next.js App Router + TS | **Next.js 16** App Router + TS | keep |
| DB / ORM | Postgres + Prisma | **Supabase Postgres + Prisma 7** | keep |
| Auth | Auth.js | **NextAuth v4** (credentials + Google, JWT) | keep; add 2FA and email verification |
| Realtime | SSE | **Supabase Realtime** (private channels, JWT bridge) | keep, no SSE |
| Jobs | Redis + BullMQ | **none**; DB outbox (`OutboxEvent`) dispatched inline | **Vercel Cron + DB-locked jobs** (no Redis) |
| Payments | fake provider first | **Stripe Checkout live code** (test mode), idempotent webhook, ledger | keep Stripe; add the interface around it |
| Tests | Vitest + Playwright | **Vitest (≈845 tests)**, pglite for DB tests | add Playwright in Phase 9 |
| i18n | next-intl EN + FR | none (EN only) | Phase 10 |
| Monitoring | Sentry | none | Phase 0 |
| Email | Resend/Postmark | **none** (in-app notifications only) | Phase 1 |
| Storage | S3 | none (no uploads) | Phase 2 (application proofs) |

### Status vocabulary (the plan's names → the app's names)
| Plan | LegendsBoost |
|---|---|
| `PENDING_PAYMENT` | `Order.status = AWAITING_PAYMENT`, an invisible **checkout hold** (an order exists for the customer only once paid) |
| `OPEN` | `PENDING` + `paymentVerifiedAt` set (shown in the marketplace) |
| `CLAIMED` | `PENDING` + an `OrderBoosterAssignment` with `activeOrderId`. **Add a real `CLAIMED` status in Phase 3.** |
| `IN_PROGRESS` / `PAUSED` | same names |
| `TARGET_REACHED`, `CONFIRMED`, `REFUNDED`, `DISPUTED` | **missing** (Phases 4 and 7) |
| `COMPLETED` / `CANCELLED` | same names |
| (none) | `DRAFT`: abandoned order waiting for admin review and republish |

---

## 1. Phase overview (adapted)

| Phase | Name | State today | Remaining size |
|---|---|---|---|
| **0** | **Audit + foundation gaps** | audit done below; gaps listed | M |
| 1 | Pricing and customer ordering | **~75% built** | M |
| 2 | Booster onboarding, permissions, rank ceiling | ~35% | M |
| 3 | Order pool, rank ceiling, **bidding** | ~15% (first-come claim only) | **L** |
| 4 | Workspace, vault, chat, completion | **~70% built** | M |
| 5 | Riot tracker (LoL) | **~70% built** | M |
| 6 | Release, abandonment, re-bidding, fines | ~20% | L |
| 7 | Earnings, payouts, refunds, disputes | ~50% | L |
| 8 | Reviews, profiles, tiers, notifications, tips | ~10% | L |
| 9 | Admin completion, analytics, hardening | ~30% | L |
| 10 | Extensions (payment methods, TFT, Valorant, loyalty, FR) | ~10% | L |

Dependencies are unchanged: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Because 4 and 5 are mostly built, Phase 3 (bidding) is now the critical path.

---

## 2. Function Evolution Registry (mapped to real code)

Status: **built** (meets the plan's v1 or better) · **partial** · **missing**.

| # | Plan function | Where it lives today | Status | Next change (phase) |
|---|---|---|---|---|
| F1 | `rankValue()` | **`lib/domain/rank.ts`** (`rankValue`, `rankScale`, `compareRanks`, `nextRank`); pricing still uses `rankLadder()` | **v1 created (P0.B)** | P3 `effectiveRankValue`, `isWithinCeiling`; P5 `progressPoints` |
| F2 | `calculatePrice()` | `lib/pricing/engine.ts` `calculateQuote()` + `eta.ts` + `coupons.ts` (division steps, LP brackets from config, additive extras, duo, **platform-funded coupons**, **ETA**) | **v2 (P1)** | P3: payout ceiling; P7: wallet; P10: loyalty |
| F3 | `createOrder()` | `lib/orders/order-creation.service.ts` (idempotency, snapshot with coupon, checkout hold, **risk consent required**) | **v2 (P1)** | P3: rank values, bidding window, ceiling |
| F4 | `transitionOrder()` | **`lib/orders/transitions.ts`** (`ORDER_TRANSITIONS`, `transitionOrder`, `transitionOrders`); all 14 status writes use it | **v1 created (P0.B)** | P3 CLAIMED; P4 TARGET_REACHED/CONFIRMED; P6 re-open; P7 REFUNDED/DISPUTED |
| F5 | `postLedgerEntries()` | `lib/finance/ledger.ts` `postLedger()` (idempotency keys, accounts) | **built v1** | P6 fines; P7 pro-rata, tips |
| F6 | `boosterPayoutForOrder()` | `OrderPricingSnapshot.boosterShareAmount` via `CommissionPolicy` (bps split), earnings `reserveBoosterShare` | **built v1** | P3: winning bid overrides; P7: pro-rata |
| F7 | `RankProvider` | **`lib/providers/rank.ts`** (`RiotRankProvider`, `MockRankProvider`, `getRankProvider()`); config `tracker_provider` (riot \| manual \| mock) now switches the Riot sync and auto-refresh off when not `riot`. **ManualProvider (booster rank reports for Valorant / TFT) deferred** until the API keys are available | **v1 (P5)** | ManualProvider when keys are ready |
| F8 | `getOrderProgress()` | **`lib/orders/order-progress.ts` `computeOrderProgress()`** (order page + Complete check); only games played in booster sessions count; LP change per game from `OrderRankSnapshot` (`lib/services/games/league-of-legends/tracker-events.ts`) | **v2 (P5)** | bonus win |
| F9 | `getAvailableOrders()` | **`lib/pool/service.ts` `getPoolForBooster()`** + `lib/pool/eligibility.ts` (paid PENDING orders filtered by rank ceiling, region, service; never an order the booster held; payout ceiling, claim-now amount, bid count, never the customer price). Legacy `getAvailableOrders()` kept for admin/tests | **v2 (P3)** | ceiling filter is in code, not SQL (fine below ~200 open orders) |
| F10 | `releaseOrder()` | `abandonOrder` / `releaseAssignment` (`lib/assignments/service.ts`): **free release within `release_grace_min` (10) before starting = back to the pool, no strike, trial order and bid margin given back**; later = LATE_RELEASE strike + DRAFT for admin review; login-change advice recorded if the login was viewed; leaving booster never sees the order again | **v2 (P6)** | P7: pro-rata pay for partial work |
| F11 | `slaWatcher` | `lib/pool/sla.ts`: contact / start warnings (missed start = strike) + **inactivity warnings** (`inactivity_warn_hours` 12, booster and admins, once per quiet spell); cron `sla-warnings`. No automatic release (decision) | **v2 (P6)** | |
| F12 | `awardOrder` / `selectWinner` | **`lib/pool/service.ts`**: `placeBid`, `withdrawBid`, `closeDueBidding` (lowest bid, ties earliest, ineligible winner skipped), `claimNow` (claim now / priority / preferred), all through `takeOrderTx`; cron `close-bidding` + lazy close on pool reads | **v1 (P3)** | P6: re-bidding after release with exclusions |
| F13 | `chatModerationFilter` | **`lib/chat/moderation.ts` `moderateChatText()`**: emails, phones, Discord, messengers, payment details hidden as "[hidden]"; original in `ChatModerationFlag` (admin page Chat Flags); admins notified; admin messages exempt | **v1 (P4)** | P6: fines / strikes for repeat flags |
| F14 | `notify()` | `lib/notifications/service.ts` + **`lib/providers/notify.ts`** (`Notifier`, in-app) + **`lib/providers/mail.ts`** (`Mailer`: log/fake) | **v1 (P0.B)**: no email/Discord yet | P1 email; P8 prefs/Discord |
| F15 | Credentials vault | `lib/security/account-credentials.ts` + `lib/orders/account-credentials.service.ts` (AES-256-GCM, order-bound AAD, DB trigger purge on COMPLETED/CANCELLED, RLS). **P4:** reveal only during a play session (`lib/orders/sessions.service.ts`), every reveal in `OrderCredentialReveal` with session and IP; no login on duo orders | **v2 (P4)** | P9: key rotation / KMS |
| F16 | Guards | `lib/auth/guards.ts`, `lib/finance/http.ts` `requireRole`, `workspace-guard.ts`; **`lib/boosters/status.ts`** `hasBoosterAccess` (APPROVED, TRIAL, ON_BREAK) and `canClaimNewOrders` | **v2 (P2)**: booster states; no 2FA | 2FA (deferred); P3: ceiling in the pool |
| F17 | Auth + 2FA | `auth.ts` (credentials + Google), login rate limit, `safeCallbackPath`, `proxy.ts` | partial: no 2FA, no email verification, no password reset, no Discord, no guest | P1: reset + verification; P2: 2FA |
| F18 | `Config` service | **`lib/config/index.ts`** + `AppConfig` table (LP brackets, hold TTL, Riot refresh, SLA/payout placeholders) | **v1 created (P0.B)** | admin editor P9; add keys per phase |
| F19 | Admin pages | `app/dashboard/admin/*`: applications, **booster page `boosters/[userId]`** (status actions, ceilings, KYC, history), orders (drafts), finance (prices, payouts, earnings, outbox, transactions, discount codes), cancellations, support | partial | every phase |
| F23 | `transitionBooster()` | **`lib/boosters/transitions.ts`** (`BOOSTER_TRANSITIONS` with who may move: admin or self); every booster status write uses it; `BoosterEvent` history + audit | **v1 created (P2)** | P6 strikes → SUSPENDED; P8 tiers |
| F24 | `BoosterPermission` | **`lib/boosters/permissions.ts`** (ceiling per game as a rank value, regions, services; default = application peak rank; booster can only lower) | **v1 created (P2)**: stored, not yet applied to the pool | P3: filter the pool |
| F20 | Customer order page | `components/orders/workspace/*` (info, game account, Riot profile, rank progress, matches, chat, pause/resume, get help, "booster is playing" notice) | **built v2** | P7 refund/dispute; P8 review/tip |
| F21 | Booster workspace | same workspace, booster view (start order, sessions with rules, reveal login, complete with Riot check, abandon, sync); admins: Complete order (admin) | **v2 (P4)** | P5 tracker card details; P6 release flow; P7 earnings link |
| F22 | `boosterStats` | **missing** (deferred from P3) | missing | P8 ratings/tiers with counters |

---

# PHASE 0: Audit and foundation gaps

**Goal:** know exactly what exists, fix the foundation gaps the later phases depend on, and do not rebuild what works.

## 0.A Audit results (2026-11-14)

✅ built · 🟡 partial · ❌ missing · ⚠️ conflicts with a later decision

### Foundation (original Phase 0 tasks)
| # | Plan item | Status | Evidence / gap |
|---|---|---|---|
| 1 | Repo, TS strict, lint, tests, CI | 🟡 | Vitest suite green (≈845). ESLint has ≈140 old errors, so `npm run lint` fails. No CI workflow. No Playwright. |
| 2 | DB, migrations, jobs, local docker | 🟡 | Prisma migrations OK (17). **No job runner** (no Redis/BullMQ/cron). No docker-compose. |
| 3 | Schema v0 | 🟡 | `User`, `Account` (OAuth), `Session`, `Notification`, `OrderRiotAccount` ✅. Missing: generic `audit_log` (only `FinancialAuditLog`), `config`, `guest_sessions`. |
| 4 | Auth: email+password, Google, Discord, guest magic link, verification, TOTP | 🟡 | Password (bcrypt) + Google ✅; brute-force limit ✅. ❌ Discord, guest magic link, email verification, **password reset (the login page links to a missing page)**, 2FA. |
| 5 | Roles + guards | 🟡 | Single `role` enum (CUSTOMER/BOOSTER/ADMIN), role re-read from DB on every request ✅. ❌ multi-role (`roles[]`), ❌ SUPPORT role. |
| 6 | Typed Config service | ❌ | Constants live in code. |
| 7 | `audit()` helper | 🟡 | Finance audit log + order events only. |
| 8 | i18n, EUR/USD | ❌ | English and USD only. |
| 9 | Error model, Zod, rate limiting | 🟡 | Zod everywhere ✅; shared Postgres rate limiter ✅; no common `AppError` codes. |
| 10 | Static catalog seed | ✅ (different form) | Catalog and rank systems in code (`lib/catalog/*`); prices in DB `ServicePrice` versions via admin; 173 LoL champions generated from Data Dragon. |
| 11 | `domain/rank.ts` `rankValue()` | 🟡 | Ladder logic exists in the pricing engine; no shared numeric scale. |
| 12 | Provider interfaces + mocks | 🟡 | Stripe and Riot are wrapped but have no interfaces; tests use fakes (`fake-stripe`, mocked Riot fetch). |
| 13 | Base layouts + guarded areas | ✅ | Public site, `/dashboard/customer`, `/dashboard/booster`, `/dashboard/admin`, `proxy.ts` sign-in redirect, error/404/loading pages. |

### Customer side (original Phase 1)
| Item | Status | Notes |
|---|---|---|
| Pricing (steps per tier, LP brackets, additive extras, duo) | ✅ | Market prices active (v3). ❌ region multiplier, ❌ ETA, ❌ coupons. |
| Validation (desired > current, modes, extras by mode) | ✅ | ❌ Flex booster count; ceiling at Master is implicit (LoL ladder ends at Master). |
| Order form + live quote (public) | ✅ | |
| `createOrder` + price snapshot + idempotency | ✅ | |
| Payment + idempotent signed webhook + ledger | ✅ | Real Stripe (test mode); chargebacks and refunds reconciled. |
| Riot account on order (Riot ID + server, verified to exist) | ✅ | Entered on the order page after payment, not at checkout. |
| Coupons | ❌ | |
| Order page (summary, status) | ✅ | |
| Cancel and refund by state | ⚠️ | **Owner decision: customers can only pause.** Admin cancel and refund exist. EU law likely requires a cancel/withdraw path; see open decision D1. |
| Guest checkout | ❌ | Account required. Conflicts with the paid-only flow; decision D2. |
| Risk disclosure checkbox | ❌ | Recommended in both the spec and the research. |
| Emails (order received, payment confirmed) | ❌ | In-app only. |

### Booster side (original Phases 2, 3, 6)
| Item | Status | Notes |
|---|---|---|
| Application form | ✅ | Peak rank, Discord, timezone, languages, availability (`applicationData` JSON). ❌ proof uploads, ❌ rules version. |
| Booster states | 🟡 | PENDING / APPROVED / REJECTED / SUSPENDED. ❌ NEEDS_INFO, TRIAL, TERMINATED, ON_BREAK, `transitionBooster()`. |
| Admin review | ✅ | Approve and reject with reason. ❌ scorecard, request info, trial. |
| Rank ceiling / permissions per game | ❌ | Any approved booster can claim any order. |
| 2FA mandatory for boosters/staff | ❌ | |
| KYC | ❌ | |
| Order pool | 🟡 | Paid orders only ✅. **Shows no payout** ❌, no filters by rank/permission ❌. |
| Claiming | 🟡 | Atomic first-come claim; one active order per booster. ❌ bidding, award, priority, preferred booster. |
| SLA timers / auto-release | ❌ | Needs the job runner. |
| Release / abandon | 🟡 | Booster abandon → DRAFT → admin republish ✅. ❌ snapshot start state, strikes, fines, cooldown, credential revoke on release. |
| Fines, strikes, appeals | ❌ | |

### Workspace, vault, chat, tracker (original Phases 4–5)
| Item | Status | Notes |
|---|---|---|
| Credentials vault | ✅ | AES-256-GCM, active booster only, IN_PROGRESS only, audited, auto-deleted on finish. ⚠️ also allowed in **duo** mode (the plan says duo has no credentials). ❌ IP in log. |
| Sessions with attestation | ❌ | |
| Chat (realtime, typing, moderation) | 🟡 | Supabase Realtime chat ✅. ❌ moderation filter, ❌ support join, ❌ first-response time, ❌ screenshots. |
| Pause / resume | ✅ | Customer pause blocks booster actions and credential reveal. |
| Completion + customer confirm + auto-confirm | 🟡 | Booster completes ✅. ❌ customer confirm, ❌ auto-confirm, ❌ TARGET_REACHED. |
| Riot tracker | ✅ mostly | Account-V1, region check, League-V4 by PUUID, Match-V5 attribution inside work windows, profile snapshot (rank, last 2 games, top 3 champions, live game), auto-refresh on a new game, Postgres-shared rate limiter with Retry-After. ❌ `ManualProvider` / provider flag, ❌ LP delta per game, ❌ anomaly alerts, ❌ retention job, ❌ "not endorsed by Riot" disclaimer. ⚠️ **development key only**; production approval is unlikely for boosting (see the research report). |

### Money, trust, admin (original Phases 7–9)
| Item | Status | Notes |
|---|---|---|
| Earnings states | 🟡 | RESERVED / PENDING_REVIEW / PENDING / ON_HOLD / … with admin approval ✅. ❌ hold period, ❌ pro-rata. |
| Payouts | 🟡 | REQUESTED → APPROVED → PROCESSING → PAID / FAILED / REJECTED, admin marks paid with a reference ✅. ❌ saved payout methods, cooldown, minimum, KYC gate. |
| Refunds | ✅ admin side | Stripe refunds reconciled, ledger reversals. |
| Disputes | 🟡 | Stripe chargebacks only. ❌ customer/booster disputes. |
| Reviews, profiles, tiers, tips | ❌ | |
| Notifications | 🟡 | In-app + realtime ✅. ❌ email, Discord, preferences. |
| Admin panel | 🟡 | Applications, drafts, finance, support ✅. ❌ booster directory, live orders board, config editor, audit viewer. |
| Security | 🟡 | Headers, rate limits, RLS on sensitive tables, encrypted credentials ✅. ❌ CSP, 2FA, key rotation, Sentry. |
| GDPR | ❌ | No export/delete; **terms and privacy pages missing**. |

## 0.B Foundation tasks (do these to finish Phase 0)
1. **`transitionOrder()` [F4]:** a table-driven `lib/orders/transitions.ts`. Route the ~15 direct `status` writes through it; add a table test with every legal and illegal transition.
2. **Config service [F18]:** `AppConfig` table (key, typed JSON value, updatedBy) + `lib/config` with defaults from section 3 and caching; admin editor later (P9). Move `lp-modifiers`, the hold TTL and the duo bps into it.
3. **`lib/domain/rank.ts` [F1]:** `rankValue(system, tier, division)` on a single numeric scale per game, plus `compareRanks` and `nextRank`. The pricing engine and tracker reuse it. Table test (LoL: Iron IV=0 … Diamond I=27, Master=28).
4. **Provider interfaces [F7]:** `RankProvider` around the existing Riot services, `PaymentProvider` around Stripe, `Mailer` and `Notifier` stubs.
5. **Job runner:** Vercel Cron → `/api/cron/*` routes protected by `CRON_SECRET`, each job idempotent with a DB lease (the pattern used by the Riot sync lease). First jobs: outbox dispatch and closing stale checkout holds.
6. **Generic `audit()` helper + `AuditLog` table** for admin and security actions. Keep `FinancialAuditLog` for money.
7. **Monitoring:** Sentry (or similar) wired to `error.tsx` digests.
8. **Lint baseline:** fix or explicitly suppress the ≈140 old ESLint errors so `npm run lint` passes; add a CI workflow (typecheck, lint, test).

### Definition of done (Phase 0)
- Every direct order status write goes through `transitionOrder()`; illegal transitions are rejected by a table test.
- Config values readable with defaults and overrides; changing one writes an audit row.
- A cron route runs a job once even when called twice in parallel.
- `npm run lint`, typecheck and tests pass in CI.

---

# PHASE 1: Pricing and customer ordering (finish)
**Already built:** pricing engine with LP, live public quote, paid-only order creation, Stripe + webhook + ledger, order page, Riot ID verified on save.
**Tasks:**
1. ETA in quote and configurator (`estimated_hours` from steps; Priority shortens) [F2].
2. Coupons (percent / fixed, caps, expiry, per-user limit) in the engine's `computeDiscount` hook [F2, F3].
3. Risk-disclosure checkbox stored with the order (version + timestamp).
4. **Password reset + email verification + Terms/Privacy pages** (blocking broken links).
5. `Mailer` (Resend/Postmark) + emails: payment confirmed, booster assigned, order completed, support reply [F14].
6. Region multiplier (optional, config) and Flex queue option.
7. Decide D1 (EU cancellation) and D2 (guest checkout); implement the chosen option.
**Done when:** a golden table of 20+ quotes passes (LP, extras, duo, coupon, ETA); emails sent through the fake `Mailer` in tests; reset flow works end to end.

# PHASE 2: Booster onboarding, permissions, rank ceiling
**Already built:** application form, admin approve/reject, APPROVED gate.
**Tasks:** `transitionBooster()` with NEEDS_INFO, TRIAL, ACTIVE, SUSPENDED, TERMINATED, ON_BREAK · `BoosterPermission` (game, queue, `maxTargetRankValue`, regions, service types, `maxConcurrentOrders`, `maxConcurrentBids`) · admin sets the ceiling; a booster can only lower it · proof uploads (`Storage`) · rules version acceptance · **2FA mandatory** for boosters and admins · `KycProvider` mock + `kycStatus`.
**Done when:** the original Phase 2 acceptance tests pass (illegal transitions rejected, ceiling rules, 2FA gate).

# PHASE 3: Pool, rank-ceiling visibility, bidding (critical path)
**Already built:** atomic first-come claim, paid-only pool.
**Tasks:** as in the original Phase 3, adapted:
- add a real `CLAIMED` order status;
- **show the booster payout ceiling** (`boosterShareAmount`) in the pool, never the customer price;
- filter by rank ceiling and permissions on the query, realtime events and notifications;
- sealed bids (`OrderBid`, history), `selectWinner` (AUTO_LOWEST), `awardOrder` transaction, window close job;
- no-bid extension and ceiling bump; priority instant claim; preferred-booster window;
- SLA v1 (contact 5 min, start 60 min) on the cron runner; minimal `releaseOrder`;
- booster counters [F22].
Use **Supabase Realtime private channels** instead of SSE. Booster eligibility is checked on the server before joining a channel (the `realtime/auth` pattern already does this).
**Done when:** the original Phase 3 acceptance list passes, including concurrency tests.

# PHASE 4: Workspace, vault, chat, completion (finish)
**Already built:** workspace, vault, chat, pause/resume, booster complete.
**Tasks:** add IP to credential reveals; **block credentials in duo mode**; sessions with a rules attestation (do not market VPN or "undetectable"); `TARGET_REACHED`, customer confirm, auto-confirm job; `chatModerationFilter` v1 (flag only); support can join chats; screenshots in chat (Storage); notifications for sessions and pauses.

# PHASE 5: Riot tracker (finish)
**Already built:** see the audit. **Tasks:** `RankProvider` interface + `ManualProvider` (booster submits rank + screenshot, support verifies) + `MockProvider`; `tracker_provider` flag (riot | manual | mock), needed because a production key is unlikely; LP delta per game by diffing snapshots; `progressPoints` (never shown as MMR); anomaly alerts for support (games while paused or outside sessions); retention job (90 days); Riot disclaimer and Riot IDs only; document key status in the README.

# PHASE 6: Release, abandonment, re-bidding, fines
**Already built:** abandon → DRAFT → admin republish. **Tasks:** full `releaseOrder` (tracker snapshot becomes the new start, remaining payout recomputed, new bidding round excluding the booster, credential access revoked, customer told to change password) · release grace window · inactivity SLA · fines engine (`FineSchedule`, `BoosterFine`, negative ledger rows) · strikes and auto-suspend · appeals · second-chance award (off by default).

# PHASE 7: Money (finish)
**Already built:** earnings states, admin payouts, Stripe refunds/chargebacks, ledger. **Tasks:** earnings hold period · pro-rata on release/refund · saved payout methods (encrypted, change cooldown, 2FA re-prompt) · minimum payout · KYC gate · payout idempotency key · customer refund rules by state (per D1) · **customer/booster disputes** (DISPUTED status, payouts frozen, evidence) · wallet + coupon ordering · monthly booster statements.

# PHASE 8: Trust and engagement
Reviews (one per completed order, tags, booster reply, admin hide) · public booster profiles + "request this booster" · tiers · `AUTO_SCORE` award · notifications v2 (email, Discord webhook without customer data, preferences, quiet hours) · availability/break mode · tips · pool filters.

# PHASE 9: Admin, analytics, hardening
Booster directory, live orders board with SLA colours, bid inspector, dispute centre, config editor, audit viewer · analytics · vault key rotation, CSP, rate limits on bid/claim/payout · **GDPR** export and delete, cookie consent · indexes and load tests · **Playwright E2E** (purchase → award → work → complete → review → payout).

# PHASE 10: Extensions
Stripe Payment Element methods (PayPal, Apple/Google Pay, Klarna) and multi-currency · real KYC and payout rails · TFT tracker (tft-league, tft-match) · Valorant via `ManualProvider` only · coaching service (hourly) · loyalty/cashback/referral (separate ledger) · French (next-intl).

---

## 3. Config keys (Appendix A, adapted)
Same table as the original Appendix A, plus keys that already exist as code constants and should move into config in Phase 0:

| Key | Current value | Where today |
|---|---|---|
| `lp_current_discount_bps` | 0 / 1500 / 3000 / 4500 / 6000 | `lib/pricing/lp-modifiers.ts` |
| `lp_gain_adjust_bps` | +3000 / 0 / −1000 | same |
| `duo_mode_bps` | 4000 | `lib/pricing/market-prices.ts` (applied to prices) |
| `checkout_hold_ttl_min` | 60 | `CHECKOUT_HOLD_TTL_MS` |
| `riot_auto_refresh_s` / `riot_full_refresh_min` | 60 / 5 | `useRiotAutoRefresh`, `auto-sync.service.ts` |
| `platform_fee_bps` / `booster_share_bps` | from `CommissionPolicy` | DB (keep, add editor) |
| `login_limits`, `register_limits` | 8/15 min per email, 30/15 min per IP, 5/h per IP | `lib/security/shared-rate-limit.ts` |

## 4. Open decisions (answer before the phase that needs them)
- **D1 (Phase 1/7) EU cancellation:** customers can currently only pause. The EU right of withdrawal likely requires a cancel request with a pro-rata refund. Options: (a) keep pause-only and accept the risk, (b) add "request cancellation" reviewed by an admin, (c) full refund-by-state table from the spec.
- **D2 (Phase 1) Guest checkout:** the spec wants guest checkout with a magic link; the app requires an account. Add it or keep accounts only?
- **D3 (Phase 3) Bidding vs first-come:** **decided 2026-11-15**: sealed bidding (1-minute window from the first bid, lowest wins, ties earliest) plus a "Claim now" button at the payout minus 25 %; priority and preferred-booster orders are claimed instantly at the full payout.
- **D4 (Phase 5) Riot data:** **open (2026-11-15)**: the platform runs on a League of Legends key today; Valorant and TFT keys and the manual fallback are set up later, when the owner has the keys (see README, "Riot API").
- **D5 (Phase 0) Missing spec:** provide `BOOSTER_ROLE_SYSTEMS.md` (B1–B20), which the plan cites for booster details.
- **D6 (Phase 8) Roles:** move from one `role` to `roles[]` (customer + booster on one account) and add a SUPPORT role?

## 5. Phase checklist
- [x] P0.A Audit (this document)
- [x] P0.B Foundation gaps (2026-11-14; migration `20261114180000_foundation_config_audit_jobs` not yet applied, see `docs/CHANGELOG.md`)
- [x] P1 Customer ordering (2026-11-14): ETA, coupons, risk notice, cancellation requests, placeholders. Deferred (no email provider): emails, password reset, email verification. Migration `20261114200000_coupons_risk_consent_cancellation` must be applied.
- [x] P2 Booster onboarding, permissions, rank ceiling (2026-11-14): `transitionBooster`, TRIAL (3 orders), ON_BREAK, NEEDS_INFO, SUSPENDED, TERMINATED, rank ceilings, proof links, rules version, mock KYC. Deferred: 2FA, proof uploads (links only). Migration `20261114220000_booster_lifecycle_permissions` must be applied, then `scripts/backfill-booster-permissions.ts`.
- [x] P3 Pool, rank ceiling, bidding (2026-11-15): pool filtered by ceilings, payout shown, sealed bids, claim now, priority, preferred booster, CLAIMED + Start, order limit per booster, SLA warnings. Deferred: booster counters (F22), Realtime pool updates (the pool refreshes when a window ends). Migration `20261115000000_pool_bidding_claimed` must be applied.
- [x] P4 Workspace, vault, chat, completion (2026-11-15): Riot check on Complete (admin review when not confirmed), play sessions required to reveal the login, reveal log with IP, no login on duo orders, chat filter (hide and flag) with an admin page. Not built by decision: customer confirmation / auto-confirm, chat screenshots. Migration `20261115120000_sessions_reveals_chat_flags` must be applied.
- [x] P5 Riot tracker (2026-11-15): games labelled booster / customer / paused by session, only session games count, LP change per game, admin alerts for games outside sessions, 15-day retention job, provider switch, Riot legal notice. Deferred until the API keys exist: Valorant / TFT tracking and manual rank reports. Migration `20261115180000_tracker_attribution_snapshots` must be applied.
- [x] P6 Release, abandonment, fines (2026-11-15): free release window, strikes (no auto-suspend), admin-only fines from a published schedule (ledger, deducted from payouts), appeals, inactivity warnings, booster Rules & Fines page, admin Fines page. Not built: second-chance award, chat-leak auto fine (fines stay admin-only). Migration `20261116000000_strikes_fines_inactivity` must be applied.
- [x] P7 Money (2026-11-16): payout methods (PayPal / IBAN / crypto, encrypted, 48 h lock after a change, copied on each payout, audited admin reveal), verified identity required for payouts, suggested split by progress for multi-booster orders. Kept by decision: manual earning approval, no minimum payout. Not built by decision: customer disputes. Not built: wallet, monthly statements, tax hooks. Migration `20261116120000_payout_methods` must be applied.
- [x] P8 Trust and engagement (2026-11-16): reviews (one per completed order, tags, filtered text, booster reply, admin hide), public booster profiles (/boosters, choose a booster for checkout), tips through Stripe split like an order. Kept by decision: lowest bid wins. Not built by decision: tiers, score-based award, Discord / email notifications. Migration `20261116180000_reviews_tips` must be applied.
- [x] P9 Admin, analytics, hardening (2026-11-17): admin Users (with account deletion requests), Boosters directory, Settings editor, Live orders board, analytics on the overview; GDPR account deletion (request, admin approval, anonymisation) and cookie notice; rate limits on bids, claims, payouts, payout methods, reviews, tips, cancellation requests, sessions and deletion requests; indexes for the hottest queries. Not built by decision: audit log viewer, data export, Playwright end-to-end tests. Migration `20261117000000_account_deletion_indexes` applied.
- [ ] P10 Extensions
