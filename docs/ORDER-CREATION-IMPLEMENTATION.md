# Order Creation Implementation

**Date:** 2026-11-12
**Scope:** server-side pricing, admin price management, customer order creation with an immutable price and commission snapshot.

---

## 1. What existed before

- The catalog (`lib/catalog/game-services.ts`, `lib/config/checkout-options.ts`) defines games, services, configuration fields, options and modes. It contains **no prices**: only a `basePriceConfigured` flag and `priceAdjustment: 0` placeholders. Every service is `draft-only` / `pending-review` / `allowOrder: false`.
- `POST /api/orders` (Phase 1) created `AWAITING_PAYMENT` orders without a price, for CUSTOMER accounts only, behind the server catalog gate.

No prices were invented. A price exists only when an admin enters it. **Nothing becomes purchasable until both of these hold:**

1. the catalog enables live ordering (`availability: "available"`, `orderCapability: "live-order"`, `complianceStatus: "approved"`, `allowOrder: true`). That is a business and compliance decision made in code, not changed here;
2. an admin has configured an **active** price.

## 2. Pricing model

`ServicePrice` (one ACTIVE version per service, versions append-only):

| Field | Meaning |
|---|---|
| `currency` | ISO-4217, upper case (validated with `Intl`). |
| `pricingModel` | `RANK_STEPS` (base + amount per rank step), `PER_UNIT` (base + unit amount × a numeric field, e.g. wins), `FIXED` (base only). |
| `baseAmount` | Integer minor units. |
| `stepAmounts` | `RANK_STEPS`: `{ tierId: amount }`, the price of each division step that starts in that tier. A step starting in an unpriced tier makes the range unpurchasable. |
| `unitFieldKey`, `unitAmount` | `PER_UNIT`: which numeric field holds the count. |
| `optionPricing`, `modePricing` | `{ id: { type: "fixed", amount } \| { type: "bps", bps } }`. Percentages apply to the service amount (base + steps/units), rounded half-up. An option or mode **missing** here cannot be purchased; `0` makes it explicitly free. |

The rank ladder is the existing catalog order (tiers by `order`, divisions in array order), the same ordering `rankScore` / `isTargetAboveCurrent` already use.

> **Catalog data issue found (not changed):** the Valorant divisions are listed `3, 2, 1`, so the ladder treats "Gold 3" as *below* "Gold 1". In VALORANT, 1 is the lowest and 3 the highest division. Fix the catalog data before enabling Valorant rank pricing, or rank-boost prices and the existing "target above current" check will both be wrong for Valorant.

### Calculation (`lib/pricing/engine.ts`, pure, integers only)

```text
service   = base + Σ steps (RANK_STEPS) | units × unitAmount (PER_UNIT) | 0 (FIXED)
mode      = fixed amount | round_half_up(service × bps / 10000)
options   = Σ fixed amount | round_half_up(service × bps / 10000)
subtotal  = service + mode + options          (must be > 0)
discount  = computeDiscount()  = 0            (disabled: no discount policy exists)
base      = subtotal − discount               (commission base)
tax       = computeTax()       = 0            (disabled: no tax rules; never part of base)
total     = base + tax
booster   = floor(base × boosterShareBps / 10000)
platform  = base − booster
```

**Example** (test fixture): Gold IV → Gold I, base 25.00 EUR, gold step 25.00:

| Line | Minor units |
|---|---:|
| Base | 2500 |
| 3 gold steps | 7500 |
| **Total** | **10000** (100.00 EUR) |
| Platform 45% | 4500 |
| Booster 55% | 5500 |

With Duo (+50%) and Priority (+25%): 10000 + 5000 + 2500 = 17500.

## 3. Validation (`lib/pricing/order-input.ts`)

The request schema is **strict**. Unknown top-level fields (`price`, `totalAmount`, `amount`, `platformFeeBps`, …) return **400**. Configuration is validated against the offer:

- unknown configuration keys are rejected; required fields must be present;
- `rank-picker`: tier must exist in the rank system; the division is required and valid when the tier has divisions, and must be null otherwise; no extra properties;
- `number`: whole number within `min`/`max` (numeric strings accepted and normalised);
- `select` / `multi-select`: values from the declared options, no duplicates;
- `checkbox`: boolean; `champion-picker`: known champion id;
- target rank above current rank;
- mode required and enabled when the service has modes;
- options must exist, be enabled, be unique, and be available in the chosen mode.

The only money-related input the browser may send is `expectedTotal: { amount, currency }`, the total it displayed. If it differs from the server quote in amount or currency, the response is **409**, so the customer is never charged a price they did not see.

## 4. Creating an order

`POST /api/orders` → `lib/orders/order-creation.service.ts`:

1. Authenticated, CUSTOMER role (route and service, re-read from the database).
2. `Idempotency-Key` header required (`[A-Za-z0-9_-]{16,128}`).
3. Server quote: catalog gate → strict validation → active `ServicePrice` → commission policy in force → calculation → `expectedTotal` check.
4. One transaction creates:
   - `Order` in `AWAITING_PAYMENT`, `paymentVerifiedAt = NULL`, the normalised configuration, and the legacy `price` / `currency` display columns derived exactly from the snapshot;
   - `OrderPricingSnapshot`, which is **immutable** (a database trigger blocks UPDATE/DELETE): currency, subtotal, discount, tax, total, commission base, both bps, both amounts, the policy id, the price version, and the line breakdown;
   - `ORDER_CREATED` event.
5. Duplicates:
   - the same key with the same normalised request returns the **same order** (200);
   - concurrent duplicates race on the unique `(userId, creationIdempotencyKey)` and the loser returns the winner;
   - the same key with a different request returns **409**.

The order is never visible to boosters until a verified payment (`docs/STRIPE-PAYMENT-IMPLEMENTATION.md`).

**Commission snapshot:** the policy in force at creation is frozen on the order. A later commission change (`POST /api/admin/finance/commission`) applies only to orders created afterwards; tests prove existing snapshots are untouched. Changing the active price creates a new version; existing orders keep theirs.

`updateDraftOrder` (admin) can no longer change `price` / `currency` on an order that has a snapshot (409); corrections go through refunds.

## 5. APIs

| Method & path | Role | Purpose |
|---|---|---|
| `POST /api/orders/quote` | CUSTOMER | Server quote for a configuration (no order). Returns lines and totals, never the commission split. |
| `POST /api/orders` | CUSTOMER | Create the order (Idempotency-Key, optional `expectedTotal`). 201 new / 200 replay. |
| `GET /api/orders/[orderId]` | owner | Public order with `pricing`; internal fields (idempotency hash, commission split, payment references) removed. |
| `GET /api/admin/finance/prices` | ADMIN | All price versions. |
| `POST /api/admin/finance/prices` | ADMIN | New ACTIVE version (validated against the catalog; retires the previous one; audited). |
| `POST /api/admin/finance/prices/[priceId]/retire` | ADMIN | Retire: the service becomes unpurchasable. |
| `GET/POST /api/admin/finance/commission` | ADMIN | Policy in force and history / new policy for future orders (`confirm: true`, not in the past, audited). |

## 6. UI

- `components/checkout/CheckoutPanel.tsx`: two steps. "Review price" calls the quote endpoint and shows the server total. "Confirm order and continue to payment" creates the order with a per-confirmation Idempotency-Key and `expectedTotal`. If the price changed (409), the quote is cleared and must be reviewed again.
- `app/checkout/review/review-client.tsx`: price lines and total from the snapshot; "Continue to Payment" only for priced `AWAITING_PAYMENT` orders.
- `app/dashboard/admin/finance/pricing/page.tsx` + `components/finance/PricingAdmin.tsx`: per service, shows "Purchasable" or the reason it is not (catalog gate or no price). Decimal inputs are converted to minor units without floats. Includes the commission change form with an explicit confirmation.

## 7. Tests (`__tests__/payments/order-creation.test.ts`, 30 tests)

| Area | Cases |
|---|---|
| Authorization | Unauthenticated 401; CUSTOMER 201; BOOSTER 403; ADMIN 403. |
| Pricing and snapshot | 100.00 → 45.00/55.00 snapshot; mode and option pricing; quote equals created total and creates nothing; a later commission change leaves existing snapshots untouched (and new orders use the new rate); a snapshot update is rejected by the database. |
| Rejected input | Unknown service 400; `draft-only` 403 even when priced; `allowOrder: false` 403; six invalid rank/configuration cases 400; four browser-price fields 400 with no order created; manipulated expected total 409; matching expected total 201; wrong currency 409; unpriced option 403; unpriced rank range 403; option not offered in the mode 400; missing Idempotency-Key 400. |
| Duplicates | Same key returns the same order once; three concurrent duplicates create one order; same key with a different request 409. |
| Marketplace | A new unpaid order is never listed. |

`__tests__/payments/migration.test.ts` (11 tests) proves the migration applies on the previous schema and enforces the money invariants in the database.
