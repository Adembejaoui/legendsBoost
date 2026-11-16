# Next.js Dynamic Route Conflict Fix

## Root Cause
Next.js 16.4.3 failed with:

`Error: You cannot use different slug names for the same dynamic path ('id' !== 'orderId').`

Two sibling dynamic segments under the same route level used different parameter names:

- `app/api/orders/[id]/route.ts` (`GET /api/orders/:id`, params `{ id }`)
- `app/api/orders/[id]/game-account/route.ts` (`PATCH /api/orders/:id/game-account`, params `{ id }`)
- `app/api/orders/[orderId]/messages/route.ts` (`GET|POST /api/orders/:orderId/messages`, params `{ orderId }`)

Next.js treats `/api/orders/[id]` and `/api/orders/[orderId]` as the same dynamic path segment; the slug name must be consistent across that level.

An additional inconsistency existed at `app/dashboard/customer/orders/[id]/page.tsx` (param `{ id }`, redirecting to `/dashboard/[orderId]`) while the canonical detail page and booster redirect already used `[orderId]`.

## Dependency Analysis (before changes)
- **API callers (URLs unchanged, still `/api/orders/<id>/...`):**
  - `app/checkout/review/review-client.tsx` → `GET /api/orders/${id}`
  - `components/payment/PaymentPageClient.tsx` → `GET /api/orders/${orderId}`
  - `components/chat/OrderChat.tsx` → `GET|POST /api/orders/${orderId}/messages`
  - `components/orders/workspace/OrderWorkspace.tsx` → `PATCH /api/orders/${order.id}/game-account`
- **Pages/roles:** canonical order detail `app/dashboard/[orderId]/page.tsx` serves customer/booster/admin with existing authorization checks; `app/dashboard/booster/orders/[orderId]/page.tsx` redirects to it; `app/dashboard/customer/orders/[id]/page.tsx` redirected to it. No routes were obsolete; `[id]` handlers provided distinct functionality (order fetch, game-account update) from `[orderId]/messages`, so they were merged under a single slug name rather than deleted.
- **Auth/API contracts:** session checks, ownership/role guards, request/response shapes, and `lib/chat/service` access checks preserved. No Prisma schema/migrations or DB data touched.

## Fix Applied (smallest safe)
Unified the order dynamic segment to `[orderId]` and updated Next.js 16 async params handling to match.

### Files changed
- **Moved/renamed:** `app/api/orders/[id]/` → merged into `app/api/orders/[orderId]/`
  - `app/api/orders/[orderId]/route.ts` (was `[id]/route.ts`): `params: Promise<{ orderId: string }>`; uses `orderId` for lookup/ownership.
  - `app/api/orders/[orderId]/game-account/route.ts` (was `[id]/game-account/route.ts`): `params: Promise<{ orderId: string }>`; uses `orderId` for find/update.
  - `app/api/orders/[orderId]/messages/route.ts`: unchanged (already `[orderId]`).
- **Removed:** `app/api/orders/[id]` directory (conflicting duplicate slug; functionality preserved under `[orderId]`).
- **Moved/renamed:** `app/dashboard/customer/orders/[id]/page.tsx` → `app/dashboard/customer/orders/[orderId]/page.tsx`; updated to `params: Promise<{ orderId: string }>` and redirect with `orderId`.

No client URL changes required; no authorization, API contract, or unrelated refactors.

## Verification
1. **`npm run dev`** (Next.js 16.4.3, Turbopack): server started successfully — `✓ Ready in 3.2s`, `- Local: http://localhost:3000`; **no `different slug names for the same dynamic path ('id' !== 'orderId')` error observed**.
2. **`npx tsc --noEmit`**: fails with pre-existing, unrelated errors in `__tests__/security/sanitize.test.ts` (lines 28:33 `',' expected`, 28:35 unterminated string literal). No TypeScript errors reported in the modified route/page files.
3. **Affected flows (static verification):** order detail/authenticated page flows not interactively exercised in this environment, but route structure, redirects (`/dashboard/customer/orders/:orderId` → `/dashboard/:orderId`, booster → `/dashboard/:orderId`), canonical `app/dashboard/[orderId]/page.tsx` role checks, and client fetch paths to `/api/orders/:orderId`, `/messages`, and `/game-account` remain consistent with preserved handler logic.

## Remaining / Separate Issues
- Pre-existing `__tests__/security/sanitize.test.ts` syntax errors causing `tsc --noEmit` to fail (unrelated to this route fix). No other new errors observed during `npm run dev` startup.
