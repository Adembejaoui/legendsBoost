# Order Purchase Eligibility — Diagnosis

Date: 2026-11-13
Symptom: when a customer creates an order, checkout shows **"This service is not available for purchase yet."**

**Verdict: the code is working as designed. No code defect causes this error.** Two separate configuration gaps each block the purchase on their own:

1. **Catalog approval (in code, first failure).** Every catalog service has `availability: 'pending-review'`, `orderCapability: 'draft-only'`, `complianceStatus: 'pending-review'` and `allowOrder: false`. The server's deny-by-default eligibility gate rejects the request at its first offer-level check, before any price is read.
2. **No price configured (admin, database).** The `servicePrice` table has **zero rows**. Even with the catalog enabled, the quote would fail with the same message, because no ACTIVE price exists.

No files were changed, because the fix is approval plus configuration. Nothing was bypassed, enabled globally, priced, approved or migrated.

---

## 1. Exact error origin

| Layer | Location | Role |
|---|---|---|
| Frontend | [components/checkout/CheckoutPanel.tsx:145-157](../components/checkout/CheckoutPanel.tsx#L145-L157) | `handleOrder` first `POST`s to `/api/orders/quote`. If the response is not OK, it shows `qd.error`, with the same string as a fallback. |
| API (quote) | [app/api/orders/quote/route.ts](../app/api/orders/quote/route.ts) | Calls `buildServerQuote` and turns `PricingError` into `{ error }` with its status (403). |
| API (create) | [app/api/orders/route.ts](../app/api/orders/route.ts) → [lib/orders/order-creation.service.ts](../lib/orders/order-creation.service.ts) | Runs the same `buildServerQuote`. Never reached, because the quote step already fails. |
| Quote service | [lib/pricing/service.ts:43-56](../lib/pricing/service.ts#L43-L56) | Runs eligibility, then input validation, the active price, the commission policy and the price engine. |
| Eligibility | [lib/orders/order-eligibility.ts:19-38](../lib/orders/order-eligibility.ts#L19-L38) | `evaluateOrderEligibility` (deny by default). |

### Every condition that produces this exact message

**Eligibility** (`lib/orders/order-eligibility.ts`, HTTP 403, `NOT_PURCHASABLE_MESSAGE`):
1. `offer.availability !== 'available'` ← **first failure for every service**
2. `offer.orderCapability` is set and not `'live-order'`
3. `offer.complianceStatus` is set and not `'approved'`
4. no checkout config exists for the game/service
5. `checkout.availability !== 'available'`
6. `checkout.orderCapability !== 'live-order'`
7. `checkout.allowOrder !== true`
8. `checkout.complianceStatus` is set and not `'approved'`

**Pricing** (`lib/pricing/service.ts`, HTTP 403, `NOT_PRICED_MESSAGE`):

9. no `servicePrice` row with `activeKey = "<gameSlug>:<serviceSlug>"` (no ACTIVE version), or the stored row is malformed (`parseServicePriceRow` returns `null`) ← **would be the next failure**

**Engine** (`lib/pricing/engine.ts`, HTTP 403):

10. `PER_UNIT` with a missing or invalid unit count, or `unitAmount == null`
11. computed subtotal `<= 0`

Related messages from the engine with different wording: *"This rank range…"* (a tier step is unpriced), *"This boost mode…"* (a mode is unpriced), *"One of the selected options…"* (an option is unpriced).

The frontend fallback string is used only when the response body has no `error`.

---

## 2. Selected service's eligibility

The report did not name a service. All 14 catalog services have identical flags, so the result is the same for any of them. **League of Legends → Rank Boost** (`league-of-legends:rank-boost`) is used below as the representative case.

A run of the real `evaluateOrderEligibility` against every catalog entry gave:

```
league-of-legends:rank-boost      | ok=false | firstFail=offer.availability=pending-review | 403 This service is not available for purchase yet.
league-of-legends:win-boost       | ok=false | firstFail=offer.availability=pending-review | 403 …
league-of-legends:placement-boost | ok=false | firstFail=offer.availability=pending-review | 403 …
league-of-legends:arena-boost     | ok=false | firstFail=offer.availability=pending-review | 403 …
league-of-legends:normal-matches  | ok=false | firstFail=offer.availability=pending-review | 403 …
league-of-legends:champion-mastery| ok=false | firstFail=offer.availability=pending-review | 403 …
valorant:rank-boost / win-boost / placement-boost / unrated-matches          | same
teamfight-tactics:rank-boost / win-boost / placement-boost / double-up-boost | same
```

### Diagnostic table — `league-of-legends:rank-boost`

| Check | Actual value | Expected value | Result |
|---|---|---|---|
| Offer visibility | `visible` | not `hidden` | ✅ Pass |
| Offer availability | `pending-review` ([game-services.ts:30](../lib/catalog/game-services.ts#L30)) | `available` | ❌ **FAIL (first failure)** |
| Offer orderCapability (draft-only restriction) | `draft-only` ([game-services.ts:34](../lib/catalog/game-services.ts#L34)) | `live-order` | ❌ Fail |
| Offer complianceStatus | `pending-review` | `approved` | ❌ Fail |
| Checkout config exists | yes | yes | ✅ Pass |
| Checkout availability | `pending-review` ([checkout-options.ts:43](../lib/config/checkout-options.ts#L43)) | `available` | ❌ Fail |
| Checkout orderCapability | `draft-only` | `live-order` | ❌ Fail |
| allowOrder | `false` ([checkout-options.ts:128](../lib/config/checkout-options.ts#L128)) | `true` | ❌ Fail |
| Checkout complianceStatus | `pending-review` | `approved` | ❌ Fail |
| Price version (active) | **none**: `servicePrice` table is empty | one ACTIVE row, `activeKey = league-of-legends:rank-boost` | ❌ Fail |
| Base price | not configured (no row) | configured (≥ 0; must not make the subtotal 0) | ❌ Fail |
| Rank prices (`stepAmounts`) | not configured | an amount for every tier a customer can start a step in: `iron, bronze, silver, gold, platinum, emerald, diamond` (`master` is the top tier and never starts a step) | ❌ Fail |
| Mode prices | not configured | `solo` and `duo` (both enabled), each `fixed` or `bps` (0 is valid) | ❌ Fail |
| Option prices | not configured | `challenger-booster`, the only option with `enabled: true`. Disabled options are rejected by the server and hidden from the admin form. | ❌ Fail |
| Currency | n/a (no row); admin form defaults to `EUR` | valid ISO code accepted by `normalizeCurrency` | ⚠️ Not set |
| Commission policy | `commission_policy_initial_45_55`: 4500 / 5500 bps, effective 2026-01-01 | an active policy | ✅ Pass |
| Rank system / ladder | `lol-ranked`, Iron→Master, 4 divisions per tier up to Diamond | consistent with the picker | ✅ Pass |
| Frontend rank value shape | `{ tierId, divisionId }` ([RankPicker.tsx:58-71](../components/configurator/RankPicker.tsx#L58-L71)) | `{ tierId, divisionId }`, strict | ✅ Pass |

DB values come from a read-only query (`BEGIN READ ONLY … ROLLBACK`) against the database in `.env`. Only `SELECT` statements on `servicePrice` and `commissionPolicy` were run.

---

## 3. Admin configuration review

| Question | Finding |
|---|---|
| Can the service be **enabled** through the UI? | **No.** `availability`, `orderCapability`, `complianceStatus` and `allowOrder` are static TypeScript in [lib/catalog/game-services.ts](../lib/catalog/game-services.ts) and [lib/config/checkout-options.ts](../lib/config/checkout-options.ts). No admin page or API writes them. The admin pricing page reads them and shows *"Not purchasable: Catalog: not enabled for live ordering…"*. This is intentional: the code says sellability needs compliance approval and is enforced on the server. |
| Can prices be configured for every required rank, mode and option? | **Yes.** [app/dashboard/admin/finance/pricing/page.tsx](../app/dashboard/admin/finance/pricing/page.tsx) and [components/finance/PricingAdmin.tsx](../components/finance/PricingAdmin.tsx) show an input for every tier of the rank system, every enabled mode and every enabled option. That matches what `validateOrderInput` accepts. |
| Does saving update the correct records? | **Yes.** `POST /api/admin/finance/prices` → `createServicePriceVersion` retires the current ACTIVE row and inserts version N+1 with `activeKey = "${gameSlug}:${serviceSlug}"`, in one transaction, with an audit entry. |
| Are price versions published correctly? | **Yes.** A new version is `ACTIVE` immediately. A retired version gets `activeKey = NULL`, so only one ACTIVE version exists per service, enforced by a unique constraint. |
| Does the customer API read what the admin writes? | **Yes.** `getActiveServicePrice` reads `servicePrice.findUnique({ where: { activeKey: "${gameSlug}:${serviceSlug}" } })`, the same key format. |
| Frontend IDs vs DB IDs vs lookup keys | **Consistent.** Slugs, tier IDs (`iron`…`master`), mode IDs (`solo`/`duo`) and option IDs are the same in catalog, admin form, request payload, `optionPricing`/`modePricing` keys and engine lookups. |

### Secondary findings (not the cause; for follow-up)

1. **Misleading button while a service is draft-only.** [CheckoutPanel.tsx:101-108](../components/checkout/CheckoutPanel.tsx#L101-L108) and [CheckoutPanel.tsx:200](../components/checkout/CheckoutPanel.tsx#L200): when `canOrder` is false, the button reads **"Create order draft"**, but `handleOrder` still calls `/api/orders/quote`, which always returns 403. Customers are asked to create a draft and then shown this error. The server is correct; the label is misleading. Suggested follow-up, out of scope here: show "Under review" or disable the button when `!canOrder`, or send drafts to `/api/orders/draft`.
2. **Duplicate option ID `champions-roles` in LoL rank-boost** ([checkout-options.ts:79-120](../lib/config/checkout-options.ts#L79-L120)): one entry for `solo`, one for `duo`. `validateOrderInput` builds `new Map(checkout.options…)`, so the duo entry wins, and selecting it in solo mode would fail with *"not available in solo mode"*. Both entries are `enabled: false` today, so this can't happen yet. Fix it before either is enabled, for example by merging into one entry with `availableModes: ['solo','duo']`.

---

## 4. Root cause

The rejection comes from **`evaluateOrderEligibility` in `lib/orders/order-eligibility.ts`**, at its first offer-level check:

```ts
if (offer.availability !== "available") return deny();   // offer.availability === "pending-review"
```

Every service in the catalog is in its pre-approval state: `pending-review`, `draft-only`, compliance `pending-review`, `allowOrder: false`. That is the intended deny-by-default behaviour, already noted in `docs/PHASE-1-ORDER-SAFETY-REPORT.md` (step 8: *"try to order any catalog service → error 'This service is not available for purchase yet.'"*).

Even if this check passed, the next one would fail too: **no service has an ACTIVE `servicePrice`**, so `buildServerQuote` would throw `NOT_PRICED_MESSAGE` (403).

**Fix type: approval plus admin configuration. No code defect.**

---

## 5. Changes made

- **Files changed:** none, apart from adding this document.
- **Not done, on purpose:** no eligibility bypass, no global enabling, no invented prices, no automatic compliance approval, no edits to migrations or database records, no migrations or database-changing SQL.

## 6. Tests performed

| Test | Result |
|---|---|
| `npx vitest run __tests__/orders/marketplace-safety.test.ts` (eligibility, quote, order-creation and price-validation suite) | ✅ 35 / 35 passed |
| Ran the real `evaluateOrderEligibility` over all 14 catalog entries (`tsx`, temporary script, deleted afterwards) | All 14: `ok=false`, first failure `offer.availability=pending-review`, 403 with this message |
| Read-only DB check of `servicePrice` | 0 rows |
| Read-only DB check of `commissionPolicy` | 1 row: 4500 / 5500 bps, effective 2026-01-01 |

**No real order-creation request was made, and none would succeed now. The service is NOT purchasable.**

---

## 7. Steps to make one service purchasable safely (example: `league-of-legends:rank-boost`)

Do these for **one approved service at a time**, never for the whole catalog.

### Step A — Compliance / business approval (prerequisite, not a code task)
Get written sign-off that LoL Rank Boost is approved for live sale. That includes the Riot Games terms and policy review behind the "Eligibility under review" labels in `lib/catalog/games.ts`. Do not go further without it.

### Step B — Enable the one approved service in the catalog (code change, reviewed PR)
Only in the `league-of-legends` / `rank-boost` entries:

- [lib/catalog/game-services.ts](../lib/catalog/game-services.ts) (entry starting at line 23):
  `availability: 'available'`, `orderCapability: 'live-order'`, `complianceStatus: 'approved'`, and update `availabilityLabel`.
- [lib/config/checkout-options.ts](../lib/config/checkout-options.ts) (entry starting at line 40):
  `availability: 'available'`, `orderCapability: 'live-order'`, `complianceStatus: 'approved'`, `allowOrder: true`.
- Before enabling any `champions-roles` option, fix the duplicate ID (secondary finding 2).
- Deploy.

### Step C — Configure the price (admin UI, `/dashboard/admin/finance/pricing`)
In the **league-of-legends · Rank Boost** card, enter values chosen by the business (none are suggested here):
- **Currency**: a valid ISO code, for example `EUR`.
- **Model**: *Per rank step*.
- **Base price**: the chosen amount.
- **Step price for every starting tier**: Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond. Master can be left empty. An empty tier makes every range that passes through it unpurchasable.
- **Modes**: Solo and Duo, each as an amount or a % (0 is allowed and means no surcharge). Empty means that mode cannot be bought.
- **Options**: Challenger Booster (0 is allowed and means free). Empty means it cannot be selected.
- Click **Save as new version**. The card should then show **"Purchasable (price v1)"**.

### Step D — Confirm commission
The commission section should show *"45% platform / 55% booster"*. It already does. Leave it unchanged.

### Step E — Verify with a real request (required before calling it purchasable)
1. Sign in as a CUSTOMER and open LoL → Rank Boost.
2. Choose current and target rank and a mode. Click **Review price**. The server total must appear.
3. Click **Confirm order and continue to payment**. `POST /api/orders` must return **201**, and the order must be `AWAITING_PAYMENT` with `paymentVerifiedAt = NULL` and an `OrderPricingSnapshot` holding the 45/55 split.
4. Only after step 3 succeeds can the service be called purchasable.
