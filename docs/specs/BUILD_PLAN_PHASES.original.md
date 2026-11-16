# BUILD PLAN: Phased Development for Claude Code

**Project:** boosting marketplace (booster system, customer system, Riot game tracker).
**Source specs (read first, keep in `/docs`):**
- `BOOSTING_PLATFORM_SPEC.md` (whole platform, audit findings, Riot API)
- `BOOSTER_ROLE_SYSTEMS.md` (booster modules B1-B20, **v2: bidding + rank ceiling**)

This file turns those specs into **ordered phases**. It also tracks which functions are written early in a simplified form and **must be updated in a later phase** (section 2, the Function Evolution Registry).

---

## 0. Rules for Claude Code (read every session)

1. **Work one phase at a time.** Do not start phase N+1 until phase N's "Definition of done" passes.
2. **Read the specs before coding.** At the start of each phase, re-read the spec sections listed under "Spec refs".
3. **Pure logic first, tested first.** Rank math, pricing, award selection, SLA math, ledger posting, progress math are pure functions with unit tests before any UI.
4. **No direct status writes.** All order status changes go through `transitionOrder()`. All booster status changes go through `transitionBooster()`.
5. **Money = integer minor units + currency.** Never floats. Never a mutable "balance" column: balances are sums of `ledger_entries`.
6. **Authorization is server-side.** UI hiding is never enough (especially rank-ceiling visibility, payout fields, credentials).
7. **Customer price is never exposed to boosters; booster payout/ledger is never exposed to customers.**
8. **Use provider interfaces** for anything external: `PaymentProvider`, `RankProvider`, `KycProvider`, `Notifier`, `Mailer`, `Storage`. Ship a fake/mock implementation first.
9. **Migrations only.** Every schema change is a migration. Seed data lives in `catalog.seed.json` and `seed.ts`.
10. **Evolving functions:** when you touch a function listed in the registry (section 2), update its registry row (`Status`, `Version`) and note what changed in `CHANGELOG.md`. Do not rewrite it from scratch: extend it and keep its tests green.
11. **Every phase ends with:** tests green, lint/typecheck clean, seed + dev server run, short `CHANGELOG.md` entry, registry updated.
12. **Do not build** (out of scope): game list/service creation UI, marketplace accounts/items/top-ups, lootboxes (until Phase 10), anything that evades Riot detection. Game catalog and services are **static seeds**.
13. When a spec detail is marked **[DECISION]** or **[ASSUMPTION v2]**, implement it as a **config value** (see Appendix A), not a hard-coded constant.

### Default stack [DECISION, replace freely]
Next.js (App Router) + TypeScript · PostgreSQL + Prisma (or Drizzle) · Redis + BullMQ · SSE (or WebSocket) for realtime · Auth.js · Zod validation · Vitest (unit) + Playwright (e2e) · next-intl (EN + FR) · Sentry · S3-compatible storage · Resend/Postmark.

### Suggested repo layout
```
/docs                          specs + BUILD_PLAN_PHASES.md + CHANGELOG.md
/src
  /domain                      PURE logic (no IO): rank.ts pricing.ts award.ts sla.ts ledger.ts progress.ts fines.ts
  /server
    /orders /bidding /boosters /payments /payouts /tracker /chat /notifications /admin
    /providers                 payment/, rank/, kyc/, mail/, storage/
    /jobs                      BullMQ workers
  /app                         Next.js routes (customer, booster, admin)
  /lib                         config, errors, auth guards, audit log
/prisma                        schema + migrations + seed
/tests                         unit, integration, e2e
```

---

## 1. Phase overview

| Phase | Name | Main outcome |
|---|---|---|
| 0 | Foundation | repo, DB, auth, roles, config, audit, seeds, rank module, provider interfaces |
| 1 | Pricing and customer ordering | quote, order creation, fake payment, webhook, ledger v1, order page v1 |
| 2 | Booster onboarding and permissions | application, admin review, booster state machine, **rank ceiling**, 2FA |
| 3 | Order pool, rank-ceiling visibility and bidding | filtered pool, sealed bids, award transaction, SLA timers |
| 4 | Booster workspace, vault, chat, completion | credentials vault, sessions, chat, completion + confirm |
| 5 | Riot tracker (LoL) | real rank/LP/match data, progress, auto-detect start/target |
| 6 | Release, abandonment, re-bidding, fines | full release flow, strikes, fines, appeals |
| 7 | Money: earnings, payouts, refunds, disputes | earnings states, pro-rata, payout flow, disputes |
| 8 | Trust and engagement | reviews, public profiles, tiers, notifications, availability, tips |
| 9 | Admin completion, analytics, hardening | admin panel, analytics, security, GDPR, load tests |
| 10 | Extensions | real payment/KYC providers, TFT, Valorant (manual), loyalty |

Dependency chain: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10. (Phase 5 can start in parallel with 4 once the `RankProvider` interface exists, but 6 needs both.)

---

## 2. Function Evolution Registry (functions created early that WILL need updates)

Read this table at the start of every phase. "Created" = first simplified version. "Updated in" = phases that must extend it. Each phase section repeats the relevant rows under **"Functions to update"**.

| # | Function / module | Created (v1) | Updated in | What changes later |
|---|---|---|---|---|
| F1 | `rankValue(tier, division)` (`domain/rank.ts`) | P0: scale Iron IV=0..Challenger=36 | P3, P5 | P3: `effectiveRankValue(service, order)` for win boost/placements and inclusive/strict flag. P5: separate `progressPoints()` for the progress bar (do not reuse as MMR) |
| F2 | `calculatePrice(quoteInput)` (`domain/pricing.ts`) | P1: base steps + additive extras + LP bracket | P3, P7, P10 | P3: also returns `booster_payout_ceiling` and `estimated_hours`. P7: coupons/wallet ordering and caps. P10: loyalty cashback |
| F3 | `createOrder()` | P1: creates PENDING_PAYMENT, stores price | P3, P7 | P3: sets `start/target_rank_value`, bidding window, ceiling payout. P7: coupons, wallet, tax/VAT |
| F4 | `transitionOrder(orderId, event, actor)` | P1: PENDING_PAYMENT, OPEN, CANCELLED | P3, P4, P6, P7 | P3: CLAIMED via award. P4: IN_PROGRESS, PAUSED, TARGET_REACHED, COMPLETED, CONFIRMED. P6: release to OPEN with new round. P7: REFUNDED, DISPUTED. Keep the transition table + tests as the single source of truth |
| F5 | `postLedgerEntries(tx, entries[])` (`domain/ledger.ts`) | P1: payment received + escrow | P4/P7, P6 | P7: earnings pending/released, pro-rata, tips. P6: FINE entries. Must always validate balanced entries |
| F6 | `boosterPayoutForOrder()` | P1: `booster_payout_ceiling = price x (1 - fee)` | P3, P7 | P3: overwritten by **winning bid** at award. P7: pro-rata on partial progress |
| F7 | `RankProvider` interface (`providers/rank`) | P0: interface + `MockProvider` | P5, P10 | P5: `RiotApiProvider`, `ManualProvider`. P10: TFT methods, Valorant manual flow |
| F8 | `getOrderProgress(orderId)` | P1/P4: reads manual/mock snapshots, linear points | P5 | P5: real snapshots, LP deltas, promotion/demotion, apex tiers, bonus win |
| F9 | `getAvailableOrders(booster, filters)` | P3: rank-ceiling + permission filter | P8, P9 | P8: closing-soon filters, notifications eligibility. P9: query optimization + cache |
| F10 | `releaseOrder(orderId, reason, actor)` | P3: minimal (used by SLA auto-release): unassign + reopen bidding | P6, P7 | P6: tracker snapshot as new start state, strike, credential revoke, customer notice. P7: pro-rata earning + re-price remaining |
| F11 | `slaWatcher` job | P3: contact (5 min) + start (60 min) deadlines | P6 | P6: inactivity release (12 h), warnings at 80%, strikes/fines integration |
| F12 | `awardOrder(orderId)` + `selectWinner(bids, mode)` | P3: `AUTO_LOWEST` | P8, P9 | P8: `AUTO_SCORE` using ratings. P9: `ADMIN_PICK` / `CUSTOMER_PICK` UI paths |
| F13 | `chatModerationFilter(text)` | P4: regex for emails/phones/handles, flag only | P6, P8 | P6: repeated hits create `CONTACT_LEAK` fine. P8: tuned patterns, whitelist |
| F14 | `notify(event, recipients)` | P1: email-only via `Mailer` stub | P8 | P8: in-app, sound, Discord, quiet hours, per-event prefs, rank-eligibility targeting |
| F15 | Credentials vault (`encryptCreds/decryptCreds`) | P4: envelope encryption + access log | P9 | P9: key rotation, purge job, break-glass access audit |
| F16 | `requireRole()` / `requirePermission()` guards | P0: roles only | P2, P3 | P2: booster status + 2FA enforcement. P3: rank-ceiling + region guard |
| F17 | Auth + 2FA | P0: email, OAuth, guest magic link; optional 2FA | P2 | P2: 2FA mandatory for boosters/staff |
| F18 | `Config` service (`lib/config`) | P0: typed config + admin-editable table | every phase | add keys as phases introduce them (Appendix A) |
| F19 | Admin pages | P2: application review | P3-P9 | each phase adds its screens; P9 finalizes |
| F20 | Order page UI (customer) | P1: status + summary | P4, P5, P7, P8 | P4: chat, pause, credentials. P5: live rank card + matches. P7: refund/dispute. P8: review + tip |
| F21 | Booster workspace UI | P4 | P5, P6, P7 | P5: tracker card. P6: release flow. P7: earnings link |
| F22 | `boosterStats` / booster aggregates | P3: counters only | P8, P9 | P8: rating, tags, tiers. P9: analytics views |

> Rule: if a function in this table is needed earlier than its "Created" phase, create the **simplest possible stub** with a TODO that names the phase that finalizes it.

---

# PHASE 0: Foundation

**Goal:** a running app skeleton with auth, roles, config, audit, seeds and the pure rank module. No business flows yet.
**Spec refs:** Platform 4.1, 8.1, 8.5; Booster B2 (roles), B15 (security basics).

### Tasks
1. Initialize repo, TypeScript strict, ESLint, Prettier, Vitest, Playwright, CI script (`lint`, `typecheck`, `test`).
2. Postgres + ORM + migration tooling; Redis; BullMQ worker process; `docker-compose.yml` for local dev.
3. **Schema v0:** `users`, `oauth_accounts`, `guest_sessions`, `audit_log`, `config`, `notifications` (basic), `riot_accounts` (minimal).
4. Auth: email+password (argon2), Google, Discord OAuth, guest checkout via magic link, email verification code. TOTP 2FA (optional now). [F17]
5. Roles: `roles[]` on users (customer, booster, support, admin). Guards `requireRole`, `requireAuthOrMagicLink`. [F16]
6. Typed `Config` service reading an admin-editable `config` table with defaults from Appendix A. [F18]
7. `audit_log` helper: `audit(actor, action, entity, payload)`.
8. i18n scaffolding (EN, FR), currency EUR/USD preference, locale-aware formatters.
9. Error model (`AppError` with codes like `ABOVE_RANK_CEILING`, `WINDOW_CLOSED`), request validation with Zod, rate limiting middleware.
10. **Static catalog:** `catalog.seed.json` with LoL (Solo/Duo rank boost, win boost optional) + price tables (see Phase 1) and rank/division enums. Seed script.
11. **`domain/rank.ts`**: `TIERS`, `DIV`, `rankValue()`, `compareRanks()`, `nextRank()`, with unit tests. [F1]
12. **Provider interfaces + mocks:** `PaymentProvider`, `RankProvider`, `KycProvider`, `Mailer`, `Storage`, `Notifier`. Mock implementations only. [F7]
13. Base layouts: public site shell, customer area, booster area, admin area (empty pages behind guards).

### Functions created here (will be updated)
F1 `rankValue` v1 · F7 `RankProvider` + Mock v1 · F14 `notify` stub · F16 guards v1 · F17 auth v1 · F18 config v1.

### Acceptance / Definition of done
- `rankValue` table test: Iron IV=0, Gold I=15, Diamond IV=24, Diamond I=27, Master=28, Grandmaster=32, Challenger=36; division ordering correct; apex has no division.
- Register/login (email, OAuth stub), guest magic link, 2FA enroll/verify works.
- Guards block cross-role access (customer cannot open `/booster/*` or `/admin/*`).
- Config reads defaults and overrides; audit log writes on admin config change.
- `pnpm test`, `typecheck`, `lint` pass; `docker compose up` runs everything.

### Claude Code prompt
> Read `/docs/BUILD_PLAN_PHASES.md` sections 0-2 and Phase 0, plus Platform spec 4.1, 8.1, 8.5. Implement Phase 0 only. Start with `domain/rank.ts` and its tests, then the schema/migrations, auth, roles, config, audit and provider interfaces with mocks. Update the registry rows F1, F7, F14, F16, F17, F18 to "v1 created". Stop when the Definition of done passes.

---

# PHASE 1: Pricing and customer ordering

**Goal:** a customer can configure an order, get a price, pay with a fake provider, and see the order page. Money enters the ledger.
**Spec refs:** Platform 2.3, 6.1-6.4, 8.2, 8.3; Booster B9 (fee model).

### Tasks
1. **Schema:** `orders`, `order_events`, `payments`, `ledger_entries`, `coupons` (basic). `orders` already includes the v2 columns (`start_rank_value`, `target_rank_value`, `booster_payout_ceiling`, `bidding_*`, `award_mode`), unused until Phase 3.
2. **`domain/pricing.ts` `calculatePrice()`:** step prices per division by tier and region multiplier; LP bracket adjustment; LP-gain bracket; **additive** extras [VERIFIED style on lolboost.gg: Priority +25%, Solo Only +20%, Stream +15%, Voice +20%, Champions +10%, Undercover +25%, Moderate KDA +20%, Hidden Duo +50%, roles free, bonus win auto]. Returns `{subtotal, discounts, total, estimated_hours, lines[]}`. Fully unit-tested table. [F2]
3. Validation: desired > current, same queue/region, duo/solo rules, booster count 1-4 only for Flex, ceiling at Master (as on lolboost.gg).
4. **Order form UI** (all fields from Platform 2.3), live quote via `POST /api/orders/quote`.
5. **`createOrder()`:** creates `PENDING_PAYMENT`, stores price breakdown and `booster_payout_ceiling = total x (1 - platform_fee_pct)` (v1). [F3, F6]
6. **`transitionOrder()` v1** with transition table + `order_events`: PENDING_PAYMENT -> OPEN, any pre-claim -> CANCELLED. [F4]
7. **`PaymentProvider` + FakeProvider:** create checkout session, simulate success/failure; `POST /api/payments/webhook/:provider` with signature check (fake HMAC) and **idempotency**. On success: ledger entries (customer payment -> escrow), order -> OPEN. [F5]
8. Riot account capture on order: Riot ID + platform; resolve PUUID via `RankProvider.resolveAccount` (Mock for now). Store in `riot_accounts` linked to the order.
9. Coupon basic (percent code) applied in quote.
10. **Customer order page v1:** header, status badge, order summary, event timeline, cancel (OPEN/PENDING only, refund ledger entry).
11. Guest checkout: magic link access to the order page.
12. Risk disclosure checkbox (ban risk) required before payment.
13. Emails via `notify` stub: order received, payment confirmed.

### Functions created here (will be updated)
F2 `calculatePrice` v1 · F3 `createOrder` v1 · F4 `transitionOrder` v1 · F5 `postLedgerEntries` v1 · F6 `boosterPayoutForOrder` v1 · F8 `getOrderProgress` stub · F20 order page v1.

### Acceptance / Definition of done
- Pricing: golden table of at least 20 quotes passes (include extras stacking, LP brackets, region multiplier, bonus win).
- Webhook replay does not double-credit or double-open; bad signature rejected.
- Ledger entries balance for payment and for cancel/refund.
- Customer cannot see another customer's order; guest magic link works once per order and expires.
- Cancel while OPEN refunds fully (ledger).

### Claude Code prompt
> Implement Phase 1. Write `domain/pricing.ts` with a golden-table test first. Then orders schema, `createOrder`, `transitionOrder` v1, ledger posting, fake payment + idempotent webhook, order form and order page v1. Keep `transitionOrder` table-driven so later phases only add rows. Update registry rows F2-F6, F8, F20.

---

# PHASE 2: Booster onboarding, permissions and rank ceiling

**Goal:** a person can apply as a booster; admin reviews, trials and approves; each approved booster has permissions including the **rank ceiling**.
**Spec refs:** Booster B1, B2, B3 (private), B15, B19 (partial); Platform 5.1, 5.2.

### Tasks
1. **Schema:** `boosters`, `booster_applications`, `booster_trials`, `booster_permissions` (with `max_target_rank_value`, `max_concurrent_orders`, `max_concurrent_bids`), `booster_game_accounts`, `booster_events`, `booster_payout_methods` (empty use), `fine_schedule` (seed).
2. **Application form** (fields in B1), proof uploads via `Storage`, versioned rules acceptance (`rules_version`).
3. **`transitionBooster()`** state machine: SUBMITTED -> NEEDS_INFO -> UNDER_REVIEW -> TRIAL -> ACTIVE <-> SUSPENDED -> TERMINATED, REJECTED, ON_BREAK. Events logged.
4. **Admin review UI:** queue, application detail, scorecard, notes, approve/reject/request info, create trial, set permissions.
5. **Rank ceiling:** admin sets `max_target_rank_value` per game+queue (dropdown of tier/division mapped through `rankValue`). Booster can only **lower** his own ceiling; raising requires admin and logs `booster_events`. Optional helper: suggest ceiling from verified peak via `RankProvider` (Mock now).
6. **2FA mandatory** for booster and staff roles (block dashboard until enrolled). [F17]
7. **Guards:** `requireActiveBooster()` and `requirePermission(game, region, service)` (rank-ceiling check added in Phase 3). [F16]
8. **KYC interface:** `KycProvider` mock; `kyc_status` on booster; gating hook used later by payouts.
9. **Private booster profile** (editable fields only) + notification prefs skeleton.
10. Emails: application received, decision, trial invite.

### Functions created here (will be updated)
`transitionBooster` v1 · F19 admin application review.
### Functions to update now
F16 guards (booster status + 2FA) · F17 auth (2FA mandatory).

### Acceptance / Definition of done
- Illegal booster transitions rejected (table test).
- Booster cannot raise own ceiling; admin raising it writes an event; lowering by booster works.
- Non-2FA booster cannot reach booster routes.
- Applicant cannot see admin routes; permissions persisted and loadable.

### Claude Code prompt
> Implement Phase 2. Start with `transitionBooster` table and tests, then schema, application form, admin review, permissions with `max_target_rank_value`, 2FA enforcement and KYC mock. Use `rankValue` from `domain/rank.ts` for the ceiling. Update registry rows F16, F17, F19 and the new `transitionBooster`.

---

# PHASE 3: Order pool, rank-ceiling visibility and bidding

**Goal:** boosters see only orders at or below their rank ceiling, place sealed bids, and the system awards a winner and starts SLA timers. This is the **v2 core**.
**Spec refs:** Booster B4, B5, B8 (basic), B13 (eligibility), Platform 5.4, 5.5; Appendix A config.

### Tasks
1. **Schema:** `order_bids`, `order_bid_history`, `order_claims_log`; ensure `orders` has `target_rank_value` (indexed), `booster_payout_ceiling`, `bidding_opens_at/closes_at`, `bidding_round`, `awarded_bid_id`, `award_mode`.
2. **Update F1:** add `effectiveRankValue(order)` (rank boost = target; win/pay-per-game/duo pass = current rank; placements = last-season or default; level/coaching = service `required_rank_value` or ungated). Add `ceiling_inclusive` handling in `isWithinCeiling(orderValue, ceiling, inclusive)`.
3. **Update F2/F3:** quote returns `booster_payout_ceiling` and `estimated_hours`; `createOrder` fills `start/target_rank_value`, `bidding_opens_at`, `bidding_closes_at` (when order becomes OPEN, window length from config).
4. **`getAvailableOrders()`** [F9]: SQL `WHERE status='OPEN' AND target_rank_value <= :ceiling` + game/queue/region/service permissions + not-blocked + not-previously-released; returns payout ceiling (never customer price), time left, bid count (not amounts). Sorting/filtering per B4.
5. **Realtime stream** (SSE): per-subscriber filtered channel; no broadcast-then-filter in the browser.
6. **Bid API** (B5 endpoints): create/edit/withdraw, validation `min_bid <= amount <= ceiling`, one active bid per booster per order, sealed (no endpoint returns others' amounts), limits (`max_concurrent_bids`), `403 ABOVE_RANK_CEILING`, `409 WINDOW_CLOSED`, `422 AMOUNT_OUT_OF_RANGE`, `404` for ineligible deep links.
7. **Award:** `selectWinner(bids, mode)` pure function (`AUTO_LOWEST`: lowest valid; tie-break rating, completed orders, earliest) + `awardOrder(orderId)` transaction: lock row, re-validate bidders (status, ceiling, permissions, capacity), set `CLAIMED`, `booster_id`, `booster_payout = winning bid`, `platform_fee = price_total - booster_payout`, mark WON/LOST, start SLA deadlines, notify. [F12, F6]
8. **Job `bidding.closeWindow`** (idempotent). No-bid flow: extend once, then ceiling bump steps (+5% up to +20%), then admin alert.
9. **Priority orders:** `claimPriorityOrder()` atomic instant claim at ceiling payout (`UPDATE ... WHERE status='OPEN'`, check rows = 1). Preferred-booster exclusive window (30 min) then general pool.
10. **Minimal `releaseOrder()`** used by the SLA watcher: unassign, reopen bidding excluding that booster, new `bidding_round`. [F10]
11. **`slaWatcher` v1:** contact deadline (5 min) and start deadline (60 min) from award time; warn at 80%, then auto-release + strike counter. [F11]
12. **Auto-reject bids** when a booster's ceiling is lowered or an order's target changes.
13. **`transitionOrder()` update:** OPEN -> CLAIMED (award or priority claim). [F4]
14. **Booster UI:** pool list (cards per B4), bid form, "my bids", countdown, won/lost notices. Customer UI: "Finding your booster" state with ETA.
15. Notifications to eligible boosters only (rank-ceiling aware) via `notify`. [F14 partial]
16. **Aggregates:** counters (completed, active, strikes) on `boosters`. [F22 v1]

### Functions created here (will be updated)
F9 `getAvailableOrders` · F10 `releaseOrder` v1 · F11 `slaWatcher` v1 · F12 `awardOrder`/`selectWinner` v1 · F22 stats v1.
### Functions to update now
F1 (effective rank, inclusive flag) · F2 (ceiling payout, hours) · F3 (rank values, window) · F4 (CLAIMED) · F6 (winning bid overwrites) · F16 (rank-ceiling guard).

### Acceptance / Definition of done
- Ceiling Diamond IV booster sees targets up to Diamond IV only; identical via REST, SSE and notifications; deep link to above-ceiling order = 404; bid = 403.
- Inclusive vs strict flag behaves as configured (table test).
- Bids: out-of-range rejected; one active per booster; sealed; late withdraw blocked; edits logged.
- Award: `[90, 85, 85(lower rating)]` -> higher-rated 85 wins; ineligible/at-capacity bidders skipped; `booster_payout` = winning bid; `platform_fee` recomputed.
- `closeWindow` run twice awards once; concurrent award/withdraw never yields two winners; priority concurrent claim yields one winner.
- SLA: no contact at 5 min warns; no start at 60 min releases and reopens bidding without that booster.
- No-bid flow extends, bumps ceiling to the cap, then alerts admin.

### Claude Code prompt
> Implement Phase 3 (v2 bidding + rank ceiling). Begin with pure functions and tests: `effectiveRankValue`, `isWithinCeiling`, `selectWinner`, SLA math. Then schema, `getAvailableOrders`, SSE, bid endpoints, `awardOrder` transaction, `closeWindow` job, priority claim, minimal `releaseOrder`, `slaWatcher`. Enforce the ceiling on query, stream, notifications, bid and award. Update registry rows F1, F2, F3, F4, F6, F9-F12, F16, F22 and write the concurrency tests.

---

# PHASE 4: Booster workspace, credentials vault, chat, completion

**Goal:** the awarded booster can do the job end to end: see requirements, reveal credentials, run sessions, chat, complete; the customer can pause, chat and confirm.
**Spec refs:** Booster B6, B7, B15; Platform 6.4, 8.5.

### Tasks
1. **Schema:** `order_credentials` (ciphertext, nonce, key_id), `credential_access_log`, `order_sessions`, `chat_threads`, `chat_messages`.
2. **Vault** [F15]: envelope encryption (KMS key interface + local dev key), `encryptCreds/decryptCreds`; reveal only for the **assigned** booster in CLAIMED/IN_PROGRESS/PAUSED; every reveal logged with IP; auto-hide in UI. Customer panel to submit/update credentials (solo only); duo mode has no credentials.
3. **Order workspace UI** (B6): summary and extras checklist, credentials panel, constraints (roles/champions/offline/stream/voice), rules reminders, status controls, sessions list, notes. [F21]
4. **Sessions:** start/end with **VPN attestation checkbox** logged; games inside a session window attributed to the booster (used in Phase 5).
5. **`transitionOrder()` update:** CLAIMED -> IN_PROGRESS (first session start or tracker), IN_PROGRESS <-> PAUSED (customer or booster), IN_PROGRESS -> TARGET_REACHED -> COMPLETED -> CONFIRMED. Customer pause blocks booster reveal/login guidance. [F4]
6. **Completion:** booster "Complete" requires target reached (tracker or manual proof) and bonus-win done; customer confirms or **auto-confirm** after `auto_confirm_hours` (job).
7. **Chat:** per-order thread, text + screenshots, system events, first-response time instrumentation, support join, transcript export. SSE stream. **`chatModerationFilter` v1** (emails, phones, Discord handles, payment strings) flags only, no fines yet. [F13]
8. **Customer order page update:** chat, pause/resume, credentials panel, completion confirm, "report a problem". [F20]
9. **`getOrderProgress` v1** from manual/mock snapshots so the UI shows progress before Phase 5. [F8]
10. Notifications: customer message, session started, paused, completed; booster message, customer paused. [F14]

### Functions created here (will be updated)
F13 chat filter v1 · F15 vault v1 · F21 workspace v1.
### Functions to update now
F4 (statuses) · F8 · F14 · F20.

### Acceptance / Definition of done
- Only the assigned booster can reveal credentials, only in allowed statuses; each reveal logged; non-assigned/other roles get 403 and no ciphertext.
- Credentials encrypted at rest (DB dump contains no plaintext).
- Customer pause moves to PAUSED and the workspace shows the notice; resume works.
- Chat flags external contact strings and records an event; first-response time stored.
- Auto-confirm job completes unconfirmed orders after the configured time.
- Illegal order transitions rejected (table test extended).

### Claude Code prompt
> Implement Phase 4. Start with the vault (tests: encrypt/decrypt, access control, logging), then sessions, order transitions, chat with the filter v1, completion + auto-confirm, workspace and order page updates. Update registry rows F4, F8, F13, F14, F15, F20, F21.

---

# PHASE 5: Riot tracker (League of Legends)

**Goal:** real rank, division, LP and match history for the customer's account; automatic progress, start detection, and target detection.
**Spec refs:** Platform section 7 (all), Booster B17.

### Tasks
1. **`RiotApiProvider`** implementing `RankProvider` [F7]:
   - Account-V1 by Riot ID/PUUID (regional host); League-V4 **entries by PUUID** (platform host); Match-V5 ids/detail/timeline (regional host); Summoner-V4 by PUUID; Spectator-V5 optional.
   - Platform -> regional map (euw1/eun1/tr1/ru -> europe; na1/br1/la1/la2 -> americas; kr/jp1 -> asia; oc1/ph2/sg2/th2/tw2/vn2 -> sea).
   - `X-Riot-Token` from server env only; HTTPS; key never in client.
2. **Rate limiter** (token bucket per key and host; dev key defaults 20 req/s and 100 per 2 min); handles 429 with `Retry-After` and backoff; request dedupe/cache.
3. **`ManualProvider`:** booster submits tier/division/LP + screenshot; support can verify. **`MockProvider`** extended with scripted sequences for tests.
4. **Schema:** `rank_snapshots`, `tracked_matches` (match_id PK), indices on `(order_id, taken_at)`.
5. **Workers:** `riot.pollActiveOrders` (IN_PROGRESS: 60-120 s; claimed-not-started: 2-3 min; paused/idle: 15 min). New match id -> fetch detail once (cache forever) -> rank snapshot -> compute **`lp_delta` by diffing snapshots** (Match-V5 has no LP).
6. **`domain/progress.ts`** [F8, F1]: `progressPoints(tier, division, lp)` for the progress bar only (`tierIdx*400 + divIdx*100 + LP`, apex uses LP), `progressFraction(start, current, target)` clamped 0-1, promotion/demotion handling, apex tiers, bonus-win requirement. **Never presented as MMR** (Riot policy forbids ELO/MMR calculators).
7. **Auto-detect:** first ranked game after award marks IN_PROGRESS and satisfies the 60-min start SLA; `TARGET_REACHED` when current >= target; flag games during PAUSED or outside booster sessions.
8. **Attribution:** `played_by` = booster when inside a session window else customer.
9. **UI:** customer live rank card (tier/division/LP, W/L, progress bar), match history list (champion, role, KDA, result, duration, LP delta), activity feed; booster workspace tracker card. [F20, F21]
10. **Anomaly alerts** (support only, no auto-punish): game during PAUSED, ranked game without open session, unusual winrate drop.
11. Riot policy items: show Riot IDs not summoner names, include the "not endorsed by Riot Games" disclaimer, data retention job (default 90 days after completion), registration of the product in the Riot Developer Portal (document status in README).
12. Feature flag `tracker_provider = riot | manual | mock` so the platform keeps working if Riot access is denied.

### Functions created here (will be updated)
`domain/progress.ts` v1 · `RiotApiProvider` v1 · `ManualProvider` v1.
### Functions to update now
F1 (separate `progressPoints`) · F7 · F8 · F10 (reads snapshots) · F11 (start detection hook) · F20 · F21.

### Acceptance / Definition of done
- Scripted snapshot sequences produce correct progress%, LP deltas, promotion/demotion, Master+ (no divisions), target reached, bonus win.
- Rate limiter never exceeds configured limits with many concurrent orders; 429 triggers backoff (test with fake clock).
- Each match fetched once (cache hit on repeats); routing map correct per platform.
- Switching `tracker_provider` to `manual` keeps the order flow working.
- API key never present in client bundles or logs.

### Claude Code prompt
> Implement Phase 5. Write `domain/progress.ts` and its tests first with scripted sequences, then the rate limiter, `RiotApiProvider` (use mocks for HTTP in tests), `ManualProvider`, snapshot/match schema, poll workers, auto-detect hooks and the UI cards. Use League-V4 `entries/by-puuid` and Match-V5 on regional hosts. Update registry rows F1, F7, F8, F10, F11, F20, F21.

---

# PHASE 6: Release, abandonment, re-bidding and fines

**Goal:** complete the failure paths: voluntary release, forced release, inactivity, strikes, fines, appeals.
**Spec refs:** Booster B8, B11, B7 (violations); Platform 5.5, 5.6.

### Tasks
1. **Full `releaseOrder()`** [F10]: validate status, **tracker snapshot as the new start state** (`start_rank_value`, progress_made), revoke credential access, flag password-change advice if the booster had solo access, recompute `booster_payout_ceiling` for the **remaining** work and `target/start_rank_value`, open a **new bidding round** excluding the releasing booster (cooldown), archive previous bids, notify customer and booster, add strike per reason code, write ledger placeholder for pro-rata (finalized in Phase 7).
2. Voluntary release rules: free within grace (10 min), reason required afterwards.
3. **`slaWatcher` update** [F11]: inactivity (12 h without tracker games/chat while IN_PROGRESS and not PAUSED), warnings at 80%, escalate to support alerts.
4. **Fines engine** (`domain/fines.ts`): schedule (B11 table) loaded from `fine_schedule`; `issueFine(booster, code, order, actor)` creates `booster_fines` + negative ledger entry; strike windows and auto-suspension threshold (3 in 30 days). [F5 update]
5. **Chat leak -> fine:** repeated `chatModerationFilter` hits create `CONTACT_LEAK` after review or threshold. [F13]
6. **Appeals:** booster submits appeal with evidence; admin accepts (reversal entry) or rejects.
7. **Second-chance award** (config, default off): offer to previous bidders at their own bid before a fresh window. [F12]
8. Booster UI: release dialog, fines list, rules + fine schedule page, appeal form. Admin UI: issue/reverse fines, force release, reassign.
9. Notifications for strikes, fines, suspensions. [F14]

### Functions created here (will be updated)
`domain/fines.ts` v1 (finalized Phase 7 for payouts interplay).
### Functions to update now
F5 (FINE entries) · F10 (full) · F11 (inactivity) · F12 (second chance) · F13 (fine hook) · F14.

### Acceptance / Definition of done
- Release after progress: next round's start state equals the snapshot; ceiling payout recomputed for remaining steps; releasing booster excluded; old credentials access revoked and logged.
- SLA and inactivity paths produce correct strikes; 3 strikes in 30 days auto-suspends.
- Fine creates a negative ledger entry; reversal restores; ledger balanced.
- Appeals flow works and is audit-logged.

### Claude Code prompt
> Implement Phase 6. Rewrite `releaseOrder` by extending the Phase 3 version (keep its tests green and add new ones). Add fines engine, strikes and appeals, inactivity detection, and the UI. Update registry rows F5, F10, F11, F12, F13, F14.

---

# PHASE 7: Money: earnings, payouts, refunds, disputes

**Goal:** complete the financial lifecycle for boosters and customers.
**Spec refs:** Booster B9, B10, B16; Platform 5.7, 6.5, 6.6, 8.3.

### Tasks
1. **Earnings states** (PENDING -> AVAILABLE -> REQUESTED -> PAID_OUT; CLAWED_BACK, FROZEN) implemented purely via ledger entries. `booster_payout` = winning bid. Hold period `earnings_hold_hours`. [F5, F6]
2. **Pro-rata** (`domain/ledger.ts`/`earnings.ts`): `earning = booster_payout x progress_fraction`, zero for negative net progress; used on release and partial refunds. [F6, F10]
3. **Earnings dashboard:** available/pending/lifetime, per-order breakdown, fines, tips placeholder, payout history.
4. **Payout methods:** add/verify (bank, PayPal, crypto), encrypted storage, **change cooldown + email confirm + 2FA re-prompt**.
5. **Payout requests:** `REQUESTED -> APPROVED -> PROCESSING -> PAID | FAILED | REJECTED | CANCELLED`; minimum payout, KYC gate, one pending payout, idempotency key, speed options (standard/expedited with fee), failed payout returns funds, optional failed-payout penalty (config). Provider interface `PayoutProvider` with fake implementation + manual "mark paid with tx ref" admin path.
6. **Admin payout queue:** approve/reject/retry/mark paid, CSV export for batch payments.
7. **Customer refunds:** by state (B16/Platform 6.5): OPEN full, CLAIMED-not-started full, IN_PROGRESS partial by progress, COMPLETED via dispute only. Ledger clawback of booster earnings when needed. [F4: REFUNDED]
8. **Disputes:** open by customer or booster with evidence (tracker snapshots, chat transcript, screenshots); order -> DISPUTED, payouts frozen; support resolutions (refund full/partial, release to booster, reassign) all audited. [F4: DISPUTED]
9. **Coupons/wallet ordering** in pricing (caps, stacking order). [F2, F3]
10. **Tax/VAT hooks** and monthly booster statements (PDF/CSV) [INFERRED, verify local rules; EU DAC7 may apply].
11. Booster UI: earnings, payout methods, payout request, statements. Customer UI: refund request, dispute. [F20, F21]

### Functions to update now
F2 · F3 · F4 (REFUNDED, DISPUTED) · F5 · F6 (pro-rata) · F10 (earnings on release) · F20 · F21.

### Acceptance / Definition of done
- Ledger always balances; booster balance equals sum of entries across a randomized property test (payments, completions, fines, refunds, payouts).
- Pro-rata table tests pass (including release mid-order and refund mid-order).
- Payout: below minimum rejected; KYC-unverified rejected; duplicate idempotency key creates one payout; failure returns funds; method change locks withdrawals for the cooldown.
- Dispute freezes payout; resolution paths post correct entries.

### Claude Code prompt
> Implement Phase 7. Property-test the ledger first, then earnings/pro-rata, payouts, refunds, disputes and the UIs. Extend (do not rewrite) F2-F6, F10. Update the registry accordingly.

---

# PHASE 8: Trust and engagement

**Goal:** reviews, public booster profiles, tiers, rich notifications, availability, tips.
**Spec refs:** Booster B3 (public), B12, B13, B14, B18; Platform 6.7, 6.8.

### Tasks
1. **Reviews:** one per completed order (stars, text, preset tags: Very Skilled, Fast Delivery, Friendly Booster, Great Communication, Would Order Again, Consistent Performance, Tilt Proof, Followed Instructions, Clean & Discreet); booster reply; hide/flag by admin; aggregates (avg, count, % 5-star, tag counts). [F22]
2. **Public booster profile** `/boosters/:id` and list `/boosters` (verified pros), "Request this booster" at checkout (preferred-booster flow from Phase 3).
3. **Tiers/reputation** (New/Verified/Pro/Elite) from completed orders, rating, completion and abandon rates; benefits via config (access to priority orders, earlier bid visibility). [F22]
4. **`AUTO_SCORE` award mode** using price, rating, completion rate, ETA (weights in config). [F12]
5. **Notifications v2** [F14]: in-app + sound, email, **Discord webhook/DM** (no customer PII), per-event/per-channel prefs, quiet hours; alerts only to rank-eligible boosters.
6. **Availability:** online/away/ON_BREAK, schedule, "schedule a break" action posting a system message and pausing SLA timers, last-seen badge.
7. **Tips:** customer tips booster after completion (ledger TIP). **Loyalty-lite:** wallet credit hook only (full loyalty in Phase 10).
8. **Pool improvements** [F9]: closing-soon, not-yet-bid filters, saved filters.
9. **Chat filter tuning** [F13]: whitelist and pattern updates.

### Functions to update now
F9 · F12 (AUTO_SCORE) · F13 · F14 · F20 (review/tip UI) · F22.

### Acceptance / Definition of done
- Only the buying customer can review a COMPLETED order, once; hidden reviews excluded from aggregates.
- `AUTO_SCORE` deterministic with configured weights (table tests); falls back to `AUTO_LOWEST` when ratings missing.
- Notification preferences respected; Discord alerts contain no customer PII and go only to eligible boosters.
- Tip creates a booster ledger entry without platform fee (or per config).

### Claude Code prompt
> Implement Phase 8. Reviews + aggregates first, then public profiles, tiers, `AUTO_SCORE`, notifications v2, availability and tips. Update registry rows F9, F12, F13, F14, F20, F22.

---

# PHASE 9: Admin completion, analytics, hardening

**Goal:** production readiness.
**Spec refs:** Booster B19, B20; Platform 8.5, 8.7, 8.8.

### Tasks
1. **Admin panel completion** [F19]: applications, booster directory (stats, strikes, fines, KYC, ceilings), live orders board with SLA colors and stuck-order alerts, bid inspector (`ADMIN_PICK`, force award, reopen bidding), dispute center, refund tool, fine tool, payout approvals, config editor (Appendix A) with audit, fine/rule schedule editor (versioned), audit log viewer.
2. `CUSTOMER_PICK` award path (anonymized offers). [F12]
3. **Analytics:** booster stats (completion/abandon rates, start delay, response time, time-to-target vs estimate, earnings per hour); platform stats (pool wait time, SLA breach rate, payout liability, margin per service). [F22]
4. **Security hardening** [F15]: vault key rotation, purge job (credentials after completion + grace; tracked data after retention), break-glass audited access, CSP, CORS, CSRF, rate limits on login/bid/claim/payout/chat, dependency audit, secrets management.
5. **GDPR:** data export, account deletion, retention jobs, cookie consent (EU), privacy/terms pages, imprint.
6. **Performance** [F9]: indexes (`orders(status, target_rank_value, bidding_closes_at)`, bids, snapshots), cache hot queries, load test the pool/bid/SSE endpoints, queue concurrency tuning.
7. **Observability:** structured logs, Sentry, metrics (poll lag, rate-limit usage, award latency), health endpoints, backup/restore drill.
8. **E2E suites** (Playwright): customer purchase -> bid -> award -> work -> complete -> confirm -> review -> payout; release/rebid path; dispute path.

### Functions to update now
F9 · F12 · F15 · F19 · F22.

### Acceptance / Definition of done
- Full E2E suites green; load test meets targets (define: p95 pool < 300 ms, award job < 1 s per order at 100 concurrent bids).
- No plaintext credentials after retention purge; key rotation test passes.
- Admin can run every operational action with audit entries.
- Security checklist signed off (authz tests for every role x endpoint).

### Claude Code prompt
> Implement Phase 9. Complete the admin panel, `CUSTOMER_PICK`, analytics, vault rotation/purge, GDPR tooling, indexes/caching and E2E suites. Update registry rows F9, F12, F15, F19, F22 and mark them "final".

---

# PHASE 10: Extensions

**Goal:** real providers and additional games. Only start after Phase 9.
**Spec refs:** Platform 6.3, 6.8, 7.5, 9 (Phase 6 list).

### Tasks
1. **Real `PaymentProvider`(s)** (Stripe/PayPal/crypto gateway) behind the existing interface; reconcile job; handle processor restrictions for gaming services (have a crypto fallback). [F2/F5 unchanged]
2. **Real `KycProvider`** (Sumsub/Persona/Stripe Identity), store status + reference only.
3. **Real payout rails** (Wise/SEPA/crypto) behind `PayoutProvider`.
4. **TFT** via the same tracker (tft-league-v1, tft-match-v1); extend `rankValue` for TFT tiers where different. [F1, F7]
5. **Valorant** with `ManualProvider` only (no public per-player rank endpoint; leaderboards only); rank scale for Valorant tiers (Iron-Radiant) in `domain/rank.ts` with its own ceiling per game. [F1, F7]
6. **Coaching/Duo-pass** service kinds (hours-based) and their ceiling rules.
7. **Full loyalty:** reward points, tiers, wallet credit, coupons, lootboxes (separate ledger). [F2]
8. Riot **production key + RSO** application if pursued; otherwise stay on the `manual`/opt-in path (keep the feature flag).
9. More languages/currencies; blog/SEO pages if desired.

### Functions to update now
F1 (multi-game rank scales) · F2 (loyalty) · F7 (TFT/Valorant).

### Acceptance / Definition of done
- Real provider integrations pass contract tests against sandbox environments.
- Valorant orders work end to end with manual progress and their own ceilings.
- Loyalty ledger balances independently and does not affect booster payouts.

### Claude Code prompt
> Implement Phase 10 items one by one, behind feature flags. For each new game, extend `rankValue` by game and add tests; do not change existing LoL behavior. Update registry rows F1, F2, F7.

---

## Appendix A. Config keys (admin-editable, typed)

| Key | Default | Introduced |
|---|---|---|
| `platform_fee_pct` (per service) | 25 | P1 |
| `bidding_window_min` | 10 | P3 |
| `bidding_extend_min` | 10 | P3 |
| `min_bid_pct` | 70 | P3 |
| `ceiling_step_pct` / `max_ceiling_bump_pct` | 5 / 20 | P3 |
| `award_mode` | `AUTO_LOWEST` | P3 |
| `ceiling_inclusive` | true | P3 |
| `priority_uses_bidding` | false | P3 |
| `preferred_booster_lock_min` | 30 | P3 |
| `max_concurrent_orders` / `max_concurrent_bids` | 3 / 10 | P2-P3 |
| `contact_sla_min` / `start_sla_min` / `reply_sla_min` | 5 / 60 / 5 | P3 |
| `release_grace_min` | 10 | P6 |
| `inactivity_release_hours` | 12 | P6 |
| `strike_threshold` (per 30 days) | 3 | P6 |
| `auto_confirm_hours` | 24 | P4 |
| `earnings_hold_hours` | 24 | P7 |
| `min_payout_minor` | 2000 (20 EUR) | P7 |
| `payout_speeds` | standard 2%/7d, expedited 5%/3d | P7 |
| `payout_method_change_cooldown_hours` | 48 | P7 |
| `failed_payout_penalty_minor` | 0 | P7 |
| `tracker_provider` | `mock` then `riot` | P5 |
| `tracker_retention_days` | 90 | P5 |
| `credential_purge_grace_hours` | 24 | P9 |
| `riot_rate_limit` | 20/s, 100/2min | P5 |

## Appendix B. Assumptions still to confirm (they change behavior, not structure)
1. Rank ceiling is inclusive (Diamond IV ceiling shows Diamond IV targets).
2. A bid is the payout the booster accepts (between 70% and 100% of the ceiling payout), customer price fixed.
3. Winner = lowest bid, sealed, after a 10-minute window.
4. Ceiling set by admin from verified peak rank; booster can only lower it.
5. Win boosts/placements use the customer's current/previous rank for the ceiling check.
6. Priority orders skip bidding; savings from lower bids go to platform margin.
7. Platform fee, fine amounts and payout minimums are placeholders.

## Appendix C. Phase checklist (tick as you go)

- [ ] P0 Foundation
- [ ] P1 Pricing and customer ordering
- [ ] P2 Booster onboarding, permissions, rank ceiling
- [ ] P3 Pool, rank-ceiling visibility, bidding
- [ ] P4 Workspace, vault, chat, completion
- [ ] P5 Riot tracker (LoL)
- [ ] P6 Release, abandonment, re-bidding, fines
- [ ] P7 Earnings, payouts, refunds, disputes
- [ ] P8 Reviews, profiles, tiers, notifications, tips
- [ ] P9 Admin, analytics, hardening
- [ ] P10 Extensions
