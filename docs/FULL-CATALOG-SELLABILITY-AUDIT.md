# Full Catalog Sellability Audit

Date: 2026-11-13
Scope: all 14 services across League of Legends (6), VALORANT (4) and Teamfight Tactics (4).

## Summary

| | Status |
|---|---|
| Technical readiness | ✅ **All 14 services complete the full purchase flow** in the end-to-end test (quote → order → Stripe Checkout → signed webhook → booster pool → claim → 45/55 ledger). The test uses the real catalog, an in-memory Postgres and a fake Stripe client. |
| Production sellability today | ❌ **0 of 14 purchasable.** Two blockers remain, and neither is a code defect. |
| Blocker 1: approval flags | Every service is still `pending-review` / `draft-only` / compliance `pending-review` / `allowOrder: false`. **This change was not applied by Claude** (see §5). The owner has to apply it. |
| Blocker 2: prices | `servicePrice` table has 0 rows (read-only check). Prices must be entered in the admin UI (§6). No prices were invented. |
| Technical defects fixed | Duplicate `champions-roles` option IDs (LoL Rank Boost and Win Boost), inverted VALORANT division order, misleading checkout button, misleading PER_UNIT error. |

---

## 1. Inventory — every game and service

Legend: **Model** is the pricing model the admin form offers (from `PricingAdmin.tsx`). **Price inputs** are the values the business must supply. "Disabled options" are configured but switched off (`enabled: false`); the server rejects them and the admin form does not list them.

### League of Legends

| Service | Fields | Model | Modes | Enabled options | Disabled options | Price inputs required | Blockers |
|---|---|---|---|---|---|---|---|
| `rank-boost` | currentRank*, targetRank* (lol-ranked) | RANK_STEPS | solo, duo | `challenger-booster` | priority-completion, stream-games, champions-roles, solo-only-queue, bonus-win, premium-coaching, hidden-duo | base; step price for iron, bronze, silver, gold, platinum, emerald, diamond; solo; duo; challenger-booster | approval flags; no price |
| `win-boost` | currentRank* (lol-ranked), wins* (1–100), gameMode | PER_UNIT on `wins` | solo, duo | *none* | all 8 (same list incl. challenger-booster) | base; price per win; solo; duo | approval flags; no price |
| `placement-boost` | placementsRemaining* (1–10), currentRank | PER_UNIT on `placementsRemaining` | solo | none | — | base; price per placement; solo | approval flags; no price |
| `arena-boost` | arenaWins* (1–50) | PER_UNIT on `arenaWins` | — | none | — | base; price per Arena win | approval flags; no price |
| `normal-matches` | matches* (1–50), gameModes | PER_UNIT on `matches` | — | none | — | base; price per match | approval flags; no price |
| `champion-mastery` | champion* , targetLevel (1–7, optional) | FIXED (or PER_UNIT on optional `targetLevel`) | solo, duo | priority-scheduling, live-stream, champion-selection, role-selection, replay-analysis, additional-time, post-session-report | — | base; solo; duo; 7 options | approval flags; no price; option set needs review (§7) |

### VALORANT

| Service | Fields | Model | Modes | Enabled options | Price inputs required | Blockers |
|---|---|---|---|---|---|---|
| `rank-boost` | currentRank*, targetRank* (valorant-competitive) | RANK_STEPS | solo, duo | none | base; step price for iron, bronze, silver, gold, platinum, diamond, ascendant, immortal; solo; duo | approval flags; no price |
| `win-boost` | wins* (1–100) | PER_UNIT on `wins` | — | none | base; price per win | approval flags; no price |
| `placement-boost` | placementsRemaining* (1–5), currentRank | PER_UNIT on `placementsRemaining` | — | none | base; price per placement | approval flags; no price |
| `unrated-matches` | matches* (1–50) | PER_UNIT on `matches` | solo, duo | priority-scheduling, live-stream, agent-selection, role-playstyle-focus, aim-training-review, vod-analysis, additional-time, post-session-report | base; price per match; solo; duo; 8 options | approval flags; no price; option set needs review (§7) |

### Teamfight Tactics

| Service | Fields | Model | Modes | Enabled options | Price inputs required | Blockers |
|---|---|---|---|---|---|---|
| `rank-boost` | currentRank*, targetRank* (tft-ranked) | RANK_STEPS | solo | none | base; step price for iron … diamond (7); solo | approval flags; no price |
| `win-boost` | wins* (1–100), currentRank | PER_UNIT on `wins` | — | none | base; price per win | approval flags; no price |
| `placement-boost` | placementsRemaining* (1–10), currentRank | PER_UNIT on `placementsRemaining` | — | none | base; price per placement | approval flags; no price |
| `double-up-boost` | currentRank*, targetRank* (tft-double-up) | RANK_STEPS | solo, duo | priority-scheduling, live-stream, composition-review, economy-leveling, augment-decision, positioning-analysis, replay-analysis, additional-time | base; step price for iron … diamond (7); solo; duo; 8 options | approval flags; no price; option set needs review (§7) |

`*` = required. The apex tier (Master for LoL/TFT, Radiant for VALORANT) is never the start of a step, so it needs no step price.

### Blocker categories found

| Category | Found | Where |
|---|---|---|
| `allowOrder: false` | 14 / 14 | `lib/config/checkout-options.ts` |
| `pending-review` / `draft-only` (offer and checkout) | 14 / 14 | `lib/catalog/game-services.ts`, `lib/config/checkout-options.ts` |
| Inconsistent approval (offer vs checkout disagree) | 0. Flags agree everywhere; now guarded by a test. | — |
| Missing service price | 14 / 14 (DB has no `servicePrice` rows) | database |
| Missing rank-tier / mode / option prices | all (no price rows at all) | database |
| Duplicate option keys | **2 → fixed** (`champions-roles` in LoL rank-boost and win-boost) | `lib/config/checkout-options.ts` |
| Invalid rank progression | **1 → fixed** (VALORANT divisions inverted) | `lib/catalog/rank-systems.ts` |
| Services that cannot complete the flow once approved and priced | **0**, verified by the E2E test | — |

---

## 2. Restriction classification

| Restriction | Classification | Action |
|---|---|---|
| `availability` / `orderCapability` / `complianceStatus` / `allowOrder` on every service | **Pending business/compliance decision.** Earlier audit item B11 (`docs/ORDER-PAYMENT-FINANCIAL-AUDIT.md`) says: *"Confirm which services may actually be sold before enabling checkout — Business / legal."* | Owner applies it (§5). Not applied by Claude. |
| `evaluateOrderEligibility` (deny by default) | **Correct technical gate.** It is not overly restrictive: it only checks the flags above. | Unchanged. |
| No active `servicePrice` | **Missing pricing configuration.** | Admin configures it (§6). |
| Unpriced option, mode or tier rejected | **Correct.** It prevents silently free extras. | Unchanged. |
| `enabled: false` on 16 option entries (LoL rank-boost and win-boost) | **Product decision.** These options carry price-like badges (`+25%`, `+15%`, `Auto`) but are switched off. | Unchanged. Listed in §7. |
| Checkout button calling the quote API for unapproved services | **Technical defect** (misleading UI) | Fixed. |

---

## 3. Changes implemented

| File | Change | Why |
|---|---|---|
| [lib/config/checkout-options.ts](../lib/config/checkout-options.ts) | Merged the two `champions-roles` entries (solo / duo) into one with `availableModes: ['solo','duo']`, in LoL `rank-boost` and `win-boost`. | `validateOrderInput` builds `new Map(options)`, so the duo entry overwrote the solo one, and choosing the option in solo mode was rejected. The admin form also rendered two inputs for one pricing key. |
| [lib/catalog/rank-systems.ts](../lib/catalog/rank-systems.ts) | VALORANT divisions reordered `['1','2','3']` (was `['3','2','1']`). | In VALORANT, 1 is the lowest division. The old order made Iron 3 the lowest rank and Iron 1 the highest, so real climbs such as Iron 1 → Iron 3 were rejected, reverse climbs were accepted, and step pricing ran backwards. IDs are unchanged, so stored selections stay valid. |
| [components/checkout/CheckoutPanel.tsx](../components/checkout/CheckoutPanel.tsx) | `canOrder` now uses the server's pure `evaluateOrderEligibility`. When a service isn't sellable, the button shows **"Under review"** and is disabled. The "Create order draft" label is gone. | Before, the button offered "Create order draft" and then called the quote API, which always returned 403. The server remains the enforcement point. |
| [lib/pricing/engine.ts](../lib/pricing/engine.ts) | PER_UNIT: a missing quantity now returns *"Enter a value for "<field label>" to calculate the price."* instead of *"not available for purchase yet"*. | A configured service looked unsellable when an optional priced field (e.g. mastery `targetLevel`) was empty. Still rejected (403); no fallback price. |
| [__tests__/catalog/catalog-integrity.test.ts](../__tests__/catalog/catalog-integrity.test.ts) | New: 94 structural tests on the real catalog. | Regression guard (below). |
| [__tests__/payments/catalog-purchase-e2e.test.ts](../__tests__/payments/catalog-purchase-e2e.test.ts) | New: the full purchase flow for all 14 services. | Phase 5 verification. |
| [__tests__/support/catalog-fixtures.ts](../__tests__/support/catalog-fixtures.ts) | New: generic catalog walker and **test-only** fixture prices. | Shared by the two tests. |

Not changed: eligibility rules, server pricing validation, payment verification gate, webhook signature checks, commission split (45/55), ledger rules, migrations, database contents.

---

## 4. Test results

### 4.1 End-to-end purchase flow, per service (`catalog-purchase-e2e.test.ts`)

The test runs on an in-memory Postgres (PGlite) built from the real migrations, with a fake Stripe client that uses the **real Stripe SDK signature verification**. No network calls and no live Stripe. Sellability flags are overridden to "approved" **inside the test only**. Prices are fixture amounts created through the real admin service `createServicePriceVersion`.

Steps checked for each service:
1. Unpriced → quote 403 *"not available for purchase yet"* (no fallback price).
2. Admin price version created: ACTIVE, correct `activeKey` and model.
3. Quote 200 for **every enabled mode, with every enabled option of that mode**. The total equals the independently computed expected total, and the commission split is not exposed.
4. Invalid input is rejected with 400 and no order is created: unknown field, unknown option, browser-supplied price field, missing or invalid mode, target ≤ current (rank), quantity 0 (per-unit).
5. A manipulated `expectedTotal` returns 409. The correct total returns 201, and the order is `AWAITING_PAYMENT`, `paymentVerifiedAt = NULL`, with a 45/55 snapshot.
6. The unpaid order is not in `getAvailableOrders()`, and `claimOrder` rejects it.
7. The Stripe Checkout session is created for exactly the snapshot amount in `eur`.
8. A badly signed webhook gets 400 and the order stays unpaid. A correctly signed `checkout.session.completed` gets `payment_succeeded`.
9. The order becomes `PENDING` + verified and appears in the pool. An approved booster claims it, with one active assignment.
10. Ledger: CUSTOMER_PAYMENT = total, PLATFORM_COMMISSION + BOOSTER_SHARE_RESERVED = total, amounts match the snapshot, and the platform share is 45%.

| Service | Model tested | Modes × options quoted | Result |
|---|---|---|---|
| league-of-legends:rank-boost | RANK_STEPS | solo + duo, with challenger-booster | ✅ pass |
| league-of-legends:win-boost | PER_UNIT (wins) | solo, duo | ✅ pass |
| league-of-legends:placement-boost | PER_UNIT (placementsRemaining) | solo | ✅ pass |
| league-of-legends:arena-boost | PER_UNIT (arenaWins) | — | ✅ pass |
| league-of-legends:normal-matches | PER_UNIT (matches) | — | ✅ pass |
| league-of-legends:champion-mastery | FIXED | solo + duo, with all 7 options | ✅ pass |
| valorant:rank-boost | RANK_STEPS | solo, duo | ✅ pass |
| valorant:win-boost | PER_UNIT (wins) | — | ✅ pass |
| valorant:placement-boost | PER_UNIT (placementsRemaining) | — | ✅ pass |
| valorant:unrated-matches | PER_UNIT (matches) | solo + duo, with all 8 options | ✅ pass |
| teamfight-tactics:rank-boost | RANK_STEPS | solo | ✅ pass |
| teamfight-tactics:win-boost | PER_UNIT (wins) | — | ✅ pass |
| teamfight-tactics:placement-boost | PER_UNIT (placementsRemaining) | — | ✅ pass |
| teamfight-tactics:double-up-boost | RANK_STEPS | solo + duo, with all 8 options | ✅ pass |

**14 / 14 passed.**

### 4.2 Catalog integrity (`catalog-integrity.test.ts`), 94 / 94 passed
For each of the 14 services:
- option IDs are unique;
- options only reference the service's modes;
- rank systems exist and belong to the same game;
- offer and checkout flags agree, so no service can be half-approved;
- the admin price validator accepts a full price for every tier, mode and enabled option;
- every mode, with all of its enabled options, passes server input validation.

For each of the 4 rank systems: tiers ascend, and every ladder step scores strictly higher. VALORANT Iron 1 < Iron 3 < Bronze 1. LoL/TFT IV < I, Master is the apex.

**Proof the guards work:** run against the original catalog files, 3 tests fail: duplicate IDs in LoL rank-boost, duplicate IDs in LoL win-boost, and VALORANT order. All pass after the fix.

### 4.3 Whole suite
`npx vitest run`: everything passes except **4 files that already failed before this work**: `security/rate-limit.test.ts` (`clearRateLimit is not a function`), `security/sanitize.test.ts`, `auth/password.test.ts` and one `assignments.service.test.ts` case. They fail the same way with the original catalog files, and none of them imports the files changed here. `chat/broadcast.test.ts` failed once on a 5 s timeout and passed on rerun. `npx tsc --noEmit`: clean. ESLint: the changed library files and new tests are clean. The remaining `CheckoutPanel.tsx` findings (`any`, set-state-in-effect) are on lines this work didn't touch.

### 4.4 Not performed
- **Real Stripe test-mode run:** not run. It would create orders in the database configured in `.env`, and nothing here confirms that database is non-production. Use `docs/STRIPE-STAGING-TEST-PLAN.md` on staging after §5 and §6.
- **No real order has been created**, so no service is claimed to be purchasable in production.

---

## 5. Business / compliance decision still required — approval flags

The requirement says all services must be purchasable, which answers audit item B11 for the business. Setting `complianceStatus: 'approved'` still **records a compliance approval in code**. Claude's attempt to apply it was blocked by the session's safety controls as an oversight-sensitive change, so **the owner has to make this change** after confirming:

- **Legal / third-party policy:** `docs/COMPREHENSIVE-PROJECT-AUDIT.md` rates boosting-related flows **HIGH product/legal risk**. Riot Games' Terms of Service and developer API policies restrict boosting and account-sharing services. The project uses a Riot API key (see the Riot product verification commit). Selling these services may put that key and the business at risk. This decision belongs to the owner or legal counsel. It is not a technical question.
- Who approved it and when. Record that in the commit message or PR.

### Exact change (owner applies it, one commit, reviewed)

From the repository root (Git Bash):

```sh
for f in lib/catalog/game-services.ts lib/config/checkout-options.ts; do
  sed -i -e "s/availability: 'pending-review',/availability: 'available',/" \
         -e "s/orderCapability: 'draft-only',/orderCapability: 'live-order',/" \
         -e "s/complianceStatus: 'pending-review',/complianceStatus: 'approved',/" \
         -e "s/allowOrder: false,/allowOrder: true,/" \
         -e "s/availabilityLabel: 'Under review',/availabilityLabel: 'Available',/" "$f"
done
```

Expected result: 14 offers + 14 checkout configs `available` / `live-order` / `approved`, and 14 × `allowOrder: true`. Then:

1. Update the customer-facing copy that still says the catalog is under review: `availabilityLabel: 'Eligibility under review'` in `lib/catalog/games.ts`; `availabilityLabel: 'Coming soon'` and the `serviceSummary` texts in `lib/games.ts`; the game descriptions *"reviewed for eligibility before publication"*.
2. Run `npx vitest run __tests__/catalog __tests__/payments`. The integrity test will fail if any service ends up half-approved.

To approve only some services, edit those entries by hand. The integrity test enforces that offer and checkout flags agree.

---

## 6. Pricing configuration still required (admin workflow)

Every value below is a business input. None has been set or guessed. Amounts are entered as decimals and stored as integer minor units.

1. Sign in as ADMIN → **Dashboard → Finance → Pricing & commission** (`/dashboard/admin/finance/pricing`).
2. Commission: shows **45% platform / 55% booster**. Leave it unchanged.
3. For each of the 14 service cards, enter:
   - **Currency** (default `EUR`).
   - **Model**: as listed in §1.
   - **Base price.**
   - **RANK_STEPS:** a step price for **every** non-apex tier. An empty tier makes every climb through it unpurchasable.
   - **PER_UNIT:** the unit field (pre-selected) and the price per unit.
   - **Modes:** every enabled mode, as an amount or a %. `0` means no surcharge; empty means that mode can't be bought.
   - **Options:** every enabled option. `0` means free; empty means that option is rejected.
   - **Save as new version.** The card must then read **"Purchasable (price vN)"**. It only reads that once §5 is also done.
4. Count of inputs: LoL 6 cards, VALORANT 4, TFT 4. Rank cards need 7 (LoL/TFT) or 8 (VALORANT) step prices. Options to price: LoL rank-boost 1, champion-mastery 7, VALORANT unrated 8, TFT double-up 8.

Existing UI badges that look like prices but **are not used by the server**: `+25%` (priority-completion, hidden-duo), `+20%` (solo-only-queue), `+15%` (stream-games, premium-coaching), `Free` (champions-roles), `Auto` (challenger-booster, bonus-win), and `priceAdjustment: { fixed, 0 }` placeholders on champion-mastery. Customers always see the server's total before confirming. If the business confirms these values, enter them in the admin form; otherwise update the badges to match.

---

## 7. Product decisions still required

| # | Decision | Detail |
|---|---|---|
| D1 | Sell the 16 disabled option entries? | LoL rank-boost: 7 disabled (all except challenger-booster). LoL win-boost: all 8 disabled, including challenger-booster, which **is** enabled on rank-boost. To sell one, set `enabled: true` and price it. `champions-roles` is now a single entry for both modes. |
| D2 | Option sets on champion-mastery, VALORANT unrated-matches and TFT double-up-boost | These are coaching-style extras ("Additional coaching time", "VOD analysis", "Post-session performance report") that look copied from a coaching template. Confirm they fit these services before pricing them. Champion mastery also offers a "duo" mode. |
| D3 | Rank-dependent pricing for win and placement boosts | These collect `currentRank` but the engine prices them per unit, the same at every rank. Rank-dependent per-unit pricing would need a new pricing model (code change). |
| D4 | Champion mastery pricing basis | `targetLevel` is optional and there is no "current level" field, so FIXED is the reliable model. To price per level, make `targetLevel` required or add a current-level field. |
| D5 | Apex tiers | LoL and TFT ladders end at **Master** (no Grandmaster/Challenger); VALORANT ends at Radiant. Extending them is a catalog change. |
| D6 | Legacy `lib/games.ts` coaching entries | "League Coaching" etc. show `price: 99` on marketing pages but are **not** in the orderable catalog, so customers can't buy them. Either remove them or add them as real catalog services with admin prices. |

---

## 8. Path to a purchasable catalog

1. Owner/legal decision and the approval change (§5). Owner commit.
2. Deploy.
3. Admin enters all prices (§6). Every card shows "Purchasable".
4. On **staging with Stripe test keys**, follow `docs/STRIPE-STAGING-TEST-PLAN.md` for at least one service per pricing model and per game: LoL rank-boost, VALORANT rank-boost, TFT double-up, one PER_UNIT and one FIXED service.
5. Only after a real test-mode order is paid and claimed can the catalog be called purchasable.
