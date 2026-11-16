# Order Workspace — UI Redesign & Lifecycle Controls

Date: 2026-11-13 · Route: `/dashboard/[orderId]` (aliases `/dashboard/orders/[orderId]`, `/dashboard/customer/orders/[orderId]`, `/dashboard/booster/orders/[orderId]` redirect to it)

**Summary.** The workspace is now a fixed-viewport dashboard: a header with the order actions, then three columns (order + Riot account · rank progression · chat), then a full-width match-history strip. The page never scrolls; only panels do. "Report current rank manually" and the order activity timeline are gone. Customers can pause and resume their order. Boosters have exactly three actions (claim, complete, abandon), and complete/abandon are refused while the order is paused. No database migration was needed, and no database was touched.

---

## 1. Existing architecture discovered

| Area | What exists |
| --- | --- |
| Route | `app/dashboard/[orderId]/page.tsx` (server) → `getOrderWorkspace()` (`lib/orders/workspace-data.ts`) → `components/orders/workspace/OrderWorkspace.tsx` (client). |
| Access policy | `lib/orders/workspace-access.ts` (`resolveWorkspaceAccess`, pure). It is used by the page and by every workspace API via `guardWorkspace()` (`lib/orders/workspace-guard.ts`). Non-participants get 404. |
| Order model | `OrderStatus`: `AWAITING_PAYMENT, PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED, DRAFT`. `AssignmentStatus` includes `PAUSED`. A paused assignment keeps `activeOrderId`, so the order is never re-listed. |
| State machine | `lib/assignments/service.ts` + transition tables in `lib/assignments/types.ts`. Writes are conditional updates inside `prisma.$transaction`, and a race shows up as P2025. |
| Operational history | `OrderEvent` rows (`lib/orders/tracking-service.ts`). **`ORDER_PAUSED` / `ORDER_RESUMED` events drive match attribution**: `buildWorkWindows()` in `match-history.service.ts` subtracts paused time, so these events must keep being written. |
| Financial records | `FinancialTransaction`, `BoosterEarning`, `FinancialAuditLog`, etc. The 45/55 split is allocated in `allocateOnCompletion()` inside the completion transaction. |
| Chat / realtime | Supabase Realtime private channel `private-order:{id}` (`lib/chat/realtime-sync.ts`, `components/chat/OrderChat.tsx`). Socket.IO had already been removed. Lifecycle events (`order.status_changed`, …) were broadcast on the same channel, but no client listened. |
| Notifications | `lib/notifications/service.ts`: persisted, then broadcast on the user channel. Recipient rules per event type; the type is a DB enum. |
| Riot | `lib/services/games/league-of-legends/*`. League-V4 rank (observed/baseline) and Match-V5 history, **League of Legends only**. VALORANT/TFT have no rank or match source. |
| Manual rank | `PATCH /api/orders/[id]/rank`, the `ReportRankForm` in `RankProgressPanel`, `canReportRank`, `selectCurrentRank()` (report-vs-Riot choice), `RankSource "reported"`, the `unconfirmed` progress flag, and the `RANK_REPORTED` event type. |
| Activity | `ActivityPanel` in `OrderStatusPanel.tsx`, plus `WorkspaceDTO.events` (all order events, filtered for non-admins). |
| Booster actions | Workspace `OrderActions.tsx` offered pause, resume, complete and abandon. The API also exposed accept, decline, start, pause, resume and release to boosters. |

## 2. Components and routes changed

**Added**
- `app/api/orders/[orderId]/pause/route.ts`, `…/resume/route.ts`, shared handler `lib/orders/customer-control-route.ts`
- `components/orders/workspace/OrderControls.tsx`: header actions (customer Pause/Resume/Cancel; booster Complete/Abandon)
- `components/orders/workspace/ConfirmDialog.tsx`: native `<dialog>` confirmation, so dialogs never change the layout
- Tests: `__tests__/orders/order-controls-routes.test.ts`, `__tests__/orders/workspace-ui.test.ts`, fixture `__tests__/support/workspace-fixture.ts`
- Evidence: `docs/order-workspace-screenshots/`

**Rewritten / changed**
- `components/orders/workspace/OrderWorkspace.tsx`: fixed-viewport grid, PAUSED banner, tabs below `lg`, live refresh on realtime lifecycle events
- `components/orders/workspace/RankProgressPanel.tsx`: Current → progress → Target, game-specific emblems, no manual reporting
- `components/orders/workspace/MatchHistoryPanel.tsx`: compact multi-column rows, internal scroll, per-game empty states
- `OrderInfoPanel.tsx`, `RiotAccountPanel.tsx`, `ChampionRolesPanel.tsx`, `Panel.tsx`: compact (`dense`) variants; Order info also shows game, service, booster, progress and games played
- `components/chat/OrderChat.tsx`: `fill` mode, participant header, `onOrderEvent`. Auto-scroll now scrolls only the message list (`scrollIntoView` also scrolled the page).
- `components/chat/useOrderChatRealtime.ts`, `lib/chat/realtime-sync.ts`: forward `order.status_changed / completed / cancelled / reassigned` from the existing channel
- `lib/assignments/service.ts`, `lib/assignments/types.ts`: customer pause/resume, booster restrictions (§6–8)
- `lib/notifications/types.ts`, `lib/notifications/service.ts`: pause/resume notifications; customer added to abandonment recipients
- `lib/orders/workspace-access.ts`, `workspace-types.ts`, `workspace-data.ts`: new action flags, pause info, per-game rank data, events and reported ranks removed
- `app/api/booster/orders/[orderId]/release/route.ts` (admin-only), `…/complete` and `…/abandon` (409 mapping)
- `lib/services/games/league-of-legends/progression.service.ts`, `riot.types.ts`; `lib/orders/tracking-service.ts`
- `docs/ORDER-WORKSPACE.md` updated to match

**Removed**
- `app/api/orders/[orderId]/rank/route.ts`
- `app/api/booster/orders/[orderId]/{pause,resume,accept,decline,start}/route.ts`
- `components/orders/workspace/OrderStatusPanel.tsx` (status + activity), `CustomerCancelOrder.tsx` (replaced by a dialog in `OrderControls`), `app/dashboard/booster/orders/[orderId]/OrderActions.tsx`
- Service functions `pauseAssignment`, `resumeAssignment`, `acceptAssignment`, `declineAssignment`, `startAssignment`; `selectCurrentRank`

## 3. New layout structure

```text
┌ header: back · Service #ID [status] · game · status text ─────────── [actions] ┐
├ PAUSED banner (only when paused) ──────────────────────────────────────────────┤
├──────────────────────┬──────────────────────────┬──────────────────────────────┤
│ Order information    │ RANK PROGRESSION         │ Chat (other participant)     │
│ Riot account         │   Current rank           │   messages (scrolls)         │
│ Champions & roles    │       ↓  81%  ▓▓▓▓░      │                              │
│   (scrolls if needed)│   Target rank            │   [ input ] [send]           │
├──────────────────────┴──────────────────────────┴──────────────────────────────┤
│ MATCH HISTORY  rows in 1–3 columns, newest first (scrolls)                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Height.** The root is `h-[calc(100dvh-7rem-1px)]`: viewport, minus the shell header (64px + 1px border), minus `main` `py-6` (48px). It is a `flex-col` with `overflow-hidden` and `min-h-0`. The column grid is `flex-1 min-h-0`; match history is `h-[clamp(128px,22dvh,250px)]`.
- **Scrolling.** Only these scroll: the left column, the chat message list, the match list, and the rank body (as a safety net; it never overflowed in testing). All use `overscroll-contain`.
- **Rank column.** Vertical Current ↓ Target in the desktop center column when the viewport is at least 820px tall; a horizontal Current → Target row otherwise. Emblem size follows viewport height (48–96px).
- **Breakpoints.**
  - **xl (≥1280px):** three columns `[250–290px | 1fr | 300–360px]`.
  - **lg (1024–1279px):** two columns. Rank on top of a scrolling details column on the left, chat on the right, history below.
  - **< lg:** one tab at a time (Overview / Chat / Matches). The active tab scrolls as one panel. All tabs stay mounted, so chat realtime keeps running.

## 4. Removed order activity

- Removed: the `ActivityPanel` UI and the `WorkspaceDTO.events` field with its event filtering (`PUBLIC_EVENT_TYPES`).
- The workspace now loads only `ORDER_PAUSED` (for the banner's "since") and `BOOSTER_ABANDONED` (admin abandonment notice) events.
- **Kept untouched:** every `OrderEvent` row and all event writes (operational history, admin use, and required for match attribution), financial and security audit logs, notifications, chat history, and the admin order pages.

## 5. Manual rank reporting removal

- **UI.** The "Report current rank manually" button and `ReportRankForm` are gone from all roles. The "Reported" badge, the "Based on a manual report" pill and the "awaiting Riot confirmation" caption are removed, and so is the Riot panel text about reported ranks.
- **API.** `PATCH /api/orders/[id]/rank` is deleted (the build route table no longer lists it).
- **Permissions and state.** `canReportRank` is removed from access and DTO; `"reported"` from `RankSource`; `unconfirmed` from progress; `selectCurrentRank()` deleted; `RANK_REPORTED` is no longer a writable event type.
- **What the current rank is now.** The Riot observation (`observedTier/…`) only, flagged stale after 24h. If there is none, the UI says why: no Riot ID, integration pending, last sync failed, or not supported for this game. It never invents a rank, LP or percentage.
- **Kept.** Riot sync, baseline capture, `observed*`/`baseline*` columns, match history and progression maths.
- **Data.** The legacy `reportedTier/Division/Lp/At/ById` columns on `orderRiotAccount` were not dropped (that would need a migration and would delete data). They are no longer read or written. Historical `RANK_REPORTED` events remain as history.

## 6. Pause/resume lifecycle and notifications

`setCustomerOrderPaused(orderId, customerId, "pause" | "resume")` in `lib/assignments/service.ts`:

1. Loads the order inside a transaction. A missing order or one owned by someone else throws `NotOrderOwnerError`, returned as 404.
2. If the order is already in the target state, it is a **no-op** (`changed: false`): no write, event or notification. This makes double clicks and retries safe.
3. Requires `IN_PROGRESS` to pause (`PAUSED` to resume) **and** an assignment holding the order (`activeOrderId = orderId`) in the matching state. Otherwise `OrderStateConflictError` (409).
4. Makes two conditional writes: `assignment.updateMany({ where: { id, status: from, activeOrderId } })` must update exactly one row, and `order.update({ where: { id, userId, status: from } })`. Any concurrent change rolls the whole transaction back (P2025 is mapped to 409).
5. Writes an `ORDER_PAUSED` / `ORDER_RESUMED` OrderEvent with `{ assignmentId, actorUserId, actorRole: "CUSTOMER" }`. That records who and when in the operational history (not a financial log) and keeps match attribution excluding paused time.
6. After commit, it notifies the booster holding the assignment (`ORDER_PAUSED_BY_CUSTOMER` / `ORDER_RESUMED_BY_CUSTOMER`, dedupe key per event) and broadcasts `order.status_changed` on the order channel. A notification failure is logged and never undoes the state change.

**Messages**
- Pause: "Order #XXXX paused by the customer. Stop boosting immediately. Do not continue playing on the customer's account until the order is resumed."
- Resume: "The customer has resumed order #XXXX. You may continue boosting."
- The new event types are stored as the existing DB value `ORDER_PROGRESS_UPDATED` (`storedNotificationType()`), so **no enum migration** was needed. The title and message are specific.

**In the UI**
- Both participants see a high-contrast **PAUSED** banner with the pause time.
- The booster's banner reads "Order paused by the customer. Stop boosting immediately. Do not continue playing…". Complete and Abandon are disabled.
- An open booster workspace refreshes immediately through the realtime event, and the booster gets a 10-second destructive toast. The 15s status probe remains the fallback.

**Not affected by pausing:** the assignment (kept), payments, refunds, the ledger, earnings and the 45/55 split (nothing financial runs), rank progress and match history.

## 7. Booster action restrictions

| Action | Enforcement |
| --- | --- |
| Claim | Unchanged `claimOrder` (approved booster, `PENDING` + verified payment, atomic conditional update, unique active assignment). |
| Complete | `completeAssignment` rejects a paused order or assignment (`OrderStateConflictError`, 409). The order update is now conditional on `status = IN_PROGRESS` only (was `IN_PROGRESS` or `PAUSED`). Completion validation and `allocateOnCompletion` (45/55) are unchanged. |
| Abandon | `abandonOrder` rejects while paused (409). Otherwise behaviour is unchanged: `IN_PROGRESS` → `DRAFT` for admin review, assignment `RELEASED` with the reason, history kept. Admins **and now the customer** are notified. |
| Pause / resume | No booster code path exists: the routes and service functions were deleted. The customer routes return 403 for boosters and admins. |
| Release | Route is admin-only (403 for boosters, who use Abandon). Admin release, reassign and cancel are unchanged. |
| Accept / decline / start | Legacy routes and functions deleted (not used by any UI since claim moved straight to `IN_PROGRESS`). |
| Target rank / configuration | Boosters have no endpoint that edits them (unchanged). Riot ID editing stays customer/admin only. |

## 8. Authorization and state-transition protections

| Current state | Actor | Action | Result |
| --- | --- | --- | --- |
| PENDING (paid) | Booster | Claim | IN_PROGRESS, assigned (unchanged atomic claim) |
| IN_PROGRESS | Customer (owner) | Pause | PAUSED; booster notified |
| PAUSED | Customer (owner) | Resume | IN_PROGRESS; booster notified |
| IN_PROGRESS | Booster (assigned) | Complete | COMPLETED (+ earnings allocation) |
| IN_PROGRESS | Booster (assigned) | Abandon | DRAFT (admin review), as before |
| PAUSED | Booster | Complete | **409 rejected** |
| PAUSED | Booster | Abandon | **409 rejected** (see decision below) |
| any | Booster / admin | Pause or resume | 403 |
| any | Other customer | Pause or resume | 404 |
| COMPLETED / CANCELLED / DRAFT / PENDING / AWAITING_PAYMENT | Customer | Pause | 409 |
| PAUSED (repeat) | Customer | Pause | 200 no-op |

**Decision: abandon while paused.** The previous code allowed `PAUSED → DRAFT`, but pauses used to be booster-initiated. Now that a pause is the customer's instruction to stop, abandoning a paused order would bypass that instruction, so it is rejected with "contact support". Admins can still release, reassign or cancel a paused order. If you'd rather allow it, delete the paused check in `abandonOrder()` and update the two tests that pin it.

Request bodies are never trusted for status, user, price, booster or rank: the pause/resume routes ignore the body entirely, and the booster routes take only `assignmentId`, which is cross-checked against the URL order and the caller.

## 9. Database changes

**None.** No schema change, no migration, no data change. `PAUSED` already existed for orders and assignments, and the pause notifications reuse an existing `NotificationType`. No command was run against the configured database. The browser check used an in-memory fixture with all network calls stubbed.

## 10. Tests executed and exact results

Vitest must be started from a `C:\` (uppercase drive letter) working directory on this machine. Otherwise every suite fails with "Vitest failed to find the runner" (Windows path casing, unrelated to the code).

| Run | Result |
| --- | --- |
| Baseline before changes | 34 files passed, **5 failed**. 703 tests passed, **21 failed**. |
| Final, after changes | 38 files passed, **3 failed**. **767 tests passed, 19 failed** (786 total). |

The **19 remaining failures are all pre-existing and unrelated**; the same files failed in the baseline:
- `__tests__/auth/password.test.ts`: "No test suite found in file" (empty suite).
- `__tests__/security/rate-limit.test.ts`: "clearRateLimit is not a function" (missing export in the untracked `lib/security`).
- `__tests__/security/sanitize.test.ts`: sanitizer expectation mismatches.

Baseline failures that are gone:
- The stale `pauseAssignment` assertion, removed together with the function.
- `realtime-auth.test.ts`: an 8.7s timeout in the baseline that passed in the final run (timing flake, untouched).

**New or updated tests**
- **Service** (`assignments.service.test.ts`):
  - Owner pause/resume, with the exact conditional writes and the event metadata.
  - The assignment stays active.
  - Booster notification and broadcast.
  - Another customer or a missing order is rejected.
  - COMPLETED/CANCELLED/PENDING/DRAFT/AWAITING_PAYMENT cannot be paused; COMPLETED/CANCELLED cannot be resumed.
  - Duplicate pause and resume are no-ops.
  - No working booster; concurrent assignment change; P2025 race.
  - A notification failure does not roll back.
  - Booster pause/resume/accept/start/decline functions no longer exist.
  - Another booster cannot complete or abandon.
  - A paused order cannot be completed, abandoned, or booster-released.
- **Routes** (`order-controls-routes.test.ts`):
  - Owner 200 with the body ignored; booster 403, admin 403, other customer 404, anonymous 401.
  - Conflict 409; ownership 404; duplicate request is a 200 no-op.
  - Booster complete/abandon of a paused order: 409. Booster release: 403; admin release still works. Customer complete/abandon: 403.
- **Access** (`workspace-access.test.ts`): new pause/resume/complete/abandon flags per role and status; `canReportRank` is gone.
- **Notifications:** pause/resume reach only the booster holding the order (not a released or foreign one); stored type and stop-instruction text; abandonment now reaches admins and the customer.
- **Lifecycle:** completion is conditional on `IN_PROGRESS`; abandon while paused is rejected with no writes.
- **Rank:** no `selectCurrentRank` and no `unconfirmed`; a stale Riot observation is flagged stale; no Riot data means no progress.
- **Phase 1:** the legacy accept/start/decline/pause/resume route files do not exist.
- **UI** (`workspace-ui.test.ts`, jsdom, 20 tests):
  - Fixed-height root with `overflow-hidden`; left/center/chat grid areas; match history below the grid; internal scrolling; tabs below `lg`; matches newest first.
  - No manual rank reporting or activity panel for customer, booster or admin.
  - Customer Pause/Resume and paused banner; booster only Complete/Abandon, disabled while paused, with the stop banner text; admin has no action buttons; no actions on COMPLETED/CANCELLED/PENDING orders.
  - League ranks and progress; VALORANT emblems and divisions with no invented LP or %; TFT shows no League data.

**Other checks**
- `npx tsc --noEmit`: **0 errors**.
- `npm run build` (prisma generate + next build): **success**. The route table confirms the removed and added routes.
- `eslint` on the changed files: no new findings. Four findings remain on lines not changed here: two `<img>` warnings in `OrderChat.tsx`, plus `any` in `lib/notifications/types.ts:54` and `lib/orders/draft-store.ts:7`. The repo-wide lint has many other pre-existing errors.

## 11. Browser evidence (desktop, tablet, mobile)

**Method.** Real Chrome (headless) driven over the DevTools protocol, with device-metrics emulation (true 390px/360px mobile, touch on) and `deviceScaleFactor` 1.
- It rendered the real `DashboardShell` and `OrderWorkspace` with in-memory fixture data, through a temporary dev-only route that was deleted afterwards.
- For each viewport it measured the document scroll size against the viewport, every panel's box, rank-body overflow, whether the chat input, Send button, action buttons and banner are fully on screen, and whether the match list scrolls internally.
- The full output is in `docs/order-workspace-screenshots/viewport-metrics.txt`.

| Viewport | Case | Page scroll Y / X | Notes |
| --- | --- | --- | --- |
| 1920×1080 | customer, LoL | no / no | 3 columns; rank vertical; chat input visible; 3-column match rows |
| 1920×1080 | customer, VALORANT | no / no | VALORANT emblems (Gold 2 → Platinum 1); "not tracked automatically" states |
| 1920×1080 | customer, COMPLETED, 40 games | no / no | match list scrolls internally |
| 1600×900 | booster, TFT | no / no | Complete / Abandon visible |
| 1440×900 | admin, paused | no / no | banner visible; no action buttons |
| 1366×768 | booster, paused | no / no | banner + disabled Complete/Abandon; rank uses row layout (height < 820) |
| 1280×720 | booster | no / no | 3 columns; left column scrolls internally |
| 1024×768 | customer (tablet landscape) | no / no | 2 columns (rank + details, chat), history below |
| 768×1024 | booster (tablet portrait) | no / no | tabs |
| 390×844 | customer, paused (Overview) | no / no | Resume visible; Overview tab panel scrolls internally |
| 390×844 | Chat tab | no / no | chat 358×621, input and Send on screen |
| 390×844 | Matches tab | no / no | full-height match list |
| 360×640 | booster, paused | no / no | actions wrap under the title; all controls on screen |

In every case, no action button was clipped, and the rank body never overflowed.

**Issues the browser run caught and that were fixed:**
1. A 1px page overflow: the shell header has a 1px border.
2. The rank column clipped on short screens: added the height-based row/column switch.
3. Rank blocks stretched apart on tall screens.
4. The left area shrank to 27px on 360×640 with the banner: the mobile tab now scrolls as one panel.
5. The title was crushed by the actions on 360px.
6. Panels were too narrow at 1024px.

Screenshots: `docs/order-workspace-screenshots/*.png`.

## 12. Remaining limitations

- **Live data not exercised in a browser.** Real customer, booster and admin sessions against the database were not used, by design: no test orders or payments were created. Realtime delivery of the new pause broadcast was verified by unit tests and by reusing the existing, tested channel, not end-to-end. Please run the manual checklist in `docs/ORDER-WORKSPACE.md` (step 3 covers pause/resume) on staging with two browsers.
- **VALORANT and TFT** have no automatic rank or match source in the codebase. The workspace shows the ordered start and target and says tracking isn't available, and progress is not computed.
  - The Riot sync itself (`sync.service.ts`) still records a League rank for any game's order. The workspace now ignores it for non-League games, but the sync was not changed.
- **No LP-change column per match.** `OrderMatch` stores no LP delta, so none is shown rather than invented. Overall LP change since the start is shown on the rank card when Riot data exists.
- **Width cap.** The shell's `max-w-7xl` (1280px) caps the workspace width on very wide screens; the shell wasn't changed to avoid affecting other dashboard pages.
- **Legacy data.** `reported*` rank columns on `orderRiotAccount` are no longer read. Dropping them would need a migration (not done). Orders paused by a booster under the old flow are shown as "This order is paused", and the customer can resume them.
- **Short screens.** At ≤ 720px height on desktop, the left column and the match list need internal scrolling (by design). Below 640px height on phones, the Overview tab scrolls internally.
- **Admins** have no pause/resume control (the brief scoped pause/resume to the customer). Admin release, reassign and cancel still work on paused orders.
