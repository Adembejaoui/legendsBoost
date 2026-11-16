# Messaging & Support Compatibility Verification

**Date:** 2026-11-10  
**Scope:** Independent verification of nullable/deleted-sender application compatibility changes. No Prisma schema changes, no migration create/modify/apply, no database writes, no `prisma db push`, no `prisma migrate resolve`, no database reset. No authorization weakening.

**Compatibility changes under review (pre-existing in workspace):** `lib/messages/sender.ts`, `components/chat/OrderChat.tsx`, `components/support/SupportTicketDetail.tsx`, `lib/chat/service.ts`, `lib/socket/client.tsx`, `__tests__/messages-deleted-sender.test.ts`.

---

## 1. Files reviewed

### Nullable-sender compatibility (focus)
- `lib/messages/sender.ts`
- `components/chat/OrderChat.tsx`
- `components/support/SupportTicketDetail.tsx`
- `lib/chat/service.ts`
- `lib/support/service.ts`
- `lib/socket/server.ts`
- `lib/socket/client.tsx`
- `lib/socket/auth.ts`
- `components/orders/workspace/OrderWorkspace.tsx`
- `app/api/orders/[orderId]/messages/route.ts`
- `app/api/support/tickets/[ticketId]/messages/route.ts`
- `app/api/support/tickets/[ticketId]/route.ts`
- `app/api/support/tickets/route.ts`
- `app/dashboard/[orderId]/page.tsx`
- `app/dashboard/support/[ticketId]/page.tsx`
- `app/dashboard/admin/support/[ticketId]/page.tsx`
- `app/dashboard/support/page.tsx`
- `app/dashboard/admin/support/page.tsx`
- `lib/notifications/service.ts`
- `lib/notifications/types.ts`
- `components/notifications/NotificationBell.tsx`
- `components/notifications/NotificationCenter.tsx`
- `prisma/schema.prisma` (intent review only)

### Tests / quality context reviewed
- `__tests__/messages-deleted-sender.test.ts`
- `__tests__/socket/auth.test.ts`
- `__tests__/socket/room-auth.test.ts`
- `__tests__/support/ticket-transitions.test.ts`
- `__tests__/assignments/reassignment-revocation.test.ts`
- `__tests__/assignments.service.test.ts`
- `__tests__/security/sanitize.test.ts`
- `vitest.config.ts`

---

## 2. Files changed during this verification, if any

- `docs/MESSAGING-SUPPORT-COMPATIBILITY-VERIFICATION.md` (**added**) — this verification report.

No application source, test, schema, migration, or database-state files were modified during this verification phase.

---

## 3. TypeScript results

**Command:** `npx tsc --noEmit`  
**Exit code:** `2`  
**Total errors:** `2`

| File | Line(s) | Error | Classification | Evidence |
|---|---:|---|---|---|
| `__tests__/security/sanitize.test.ts` | 28:33, 28:35 | `TS1005: ',' expected`, `TS1002: Unterminated string literal` | **Pre-existing / unrelated to nullable sender changes** | Errors are syntax issues inside `sanitize.test.ts` string literal (`"Special chars: & < > \" '"` followed by malformed quoted line in that test). This file and `lib/security/sanitize.ts` are not part of the nullable-sender change set and do not involve sender/message schema fields. No evidence links these parse errors to `OrderMessage.senderId`, `SupportMessage.senderId`, or sender rendering/types. |
| — | — | — | **New errors caused by nullable sender changes:** **None observed** | `tsc` reported only the 2 errors above; no type errors were reported in `lib/messages/sender.ts`, `components/chat/OrderChat.tsx`, `components/support/SupportTicketDetail.tsx`, `lib/chat/service.ts`, `lib/socket/client.tsx`, or message API/socket/support call sites reviewed. |

**Note:** Full-project `tsc` did not complete with success due pre-existing unrelated parse errors in `__tests__/security/sanitize.test.ts`.

---

## 4. Test results

### 4.1 Executed

| Command | Result | Details |
|---|---|---|
| `npx vitest run __tests__/messages-deleted-sender.test.ts` (earlier in compatibility implementation, same workspace state) | **PASS** | 1 file, 4 tests passed. Confirms shared deleted-sender label/helper behavior (`null`, `undefined`, existing sender, null-name fallback). |
| `npx vitest run __tests__/messages-deleted-sender.test.ts __tests__/socket/auth.test.ts __tests__/socket/room-auth.test.ts __tests__/support/ticket-transitions.test.ts __tests__/assignments/reassignment-revocation.test.ts __tests__/assignments.service.test.ts` | **FAIL (suite-level, mixed causes)** | **Test Files:** 5 failed, 1 passed (6). **Tests:** 25 failed, 25 passed (50). Duration ~27.5s. Vitest warning: unsupported `configLoader: 'native'` / ESM syntax in `vitest.config.ts` (environment warning). |

### 4.2 Breakdown of executed relevant suites

| Suite | Status | Evidence / cause classification |
|---|---|---|
| `__tests__/messages-deleted-sender.test.ts` | **PASS** (when run directly; part of targeted verification) | Covers deleted-sender label behavior required for nullable sender compatibility. |
| `__tests__/support/ticket-transitions.test.ts` | **Suite FAIL (unrelated environment/dependency issue)** | Failed to resolve import `isomorphic-dompurify` from `lib/security/sanitize.ts` during transform. Not caused by nullable sender changes; support transition logic not executed in this run. |
| `__tests__/socket/auth.test.ts` | **FAIL (pre-existing test/API mismatch)** | Tests import/call `verifySocketAuth` from `@/lib/socket/auth` and mock `@/lib/auth/guards`; actual module exports `verifySocketToken`, `getSocketAuthFromCookies`, `extractTokenFromHandshake` and uses `jose`/cookies (no `verifySocketAuth`, no `getSessionUser` guard dependency). No evidence of relation to nullable sender changes. |
| `__tests__/socket/room-auth.test.ts` | **FAIL (pre-existing test/API mismatch)** | Tests expect exported `canAccessOrder/canAccessTicket` functions with different signatures and `revokeOrderAccess(mockSocket, orderId)` socket-mutation behavior; implementation provides async `canAccessOrder(userId,userRole,orderId)`/`verifyOrderAccess` and async `revokeOrderAccess(userId, orderId)` that operates on server socket registry. Mocks also assume different Prisma shapes (`customerId` vs `userId`, `findFirst` usage patterns). Unrelated to nullable sender fields. |
| `__tests__/assignments/reassignment-revocation.test.ts` | **FAIL (pre-existing test/API mismatch)** | Expects `revokeOrderAccess(socket/order-like arg, orderId)` but implementation/service calls `revokeOrderAccess(userId/boosterId, orderId)`; reassignment tests also fail with `Only admins can reassign orders` under current service guards/mocks, indicating outdated test assumptions. Unrelated to nullable sender changes. |
| `__tests__/assignments.service.test.ts` | **FAIL (2 tests) / PASS (20 tests)** | Failures: concurrent `claimOrder` expected one fulfilled/one rejected but got 0 fulfilled in this run (transaction/mock behavior), and `pauseAssignment` expected raw updated assignment equality but service returns `{ assignment, order }` shape. These are service-contract/test-environment issues, not sender-nullability issues. 20 other assignment tests passed. |

### 4.3 Coverage gaps (no existing suites found / not executed)

- **Order chat component/API integration tests:** no dedicated tests found under `__tests__` matching order chat/message API behavior.
- **Support message API integration tests:** no dedicated tests found for `POST /api/support/tickets/[ticketId]/messages` or support ticket detail message rendering with null senders.
- **Socket.IO message event runtime tests:** no existing automated tests validating `message:new` / `support:message:new` payload handling with `sender: null` / `senderId: null` in connected clients.
- **Notification creation/rendering with deleted sender:** `NEW_MESSAGE` metadata fallback to `Deleted user` is implemented and type-safe by inspection; no automated notification suite executed for this scenario.
- **Assignment/reassignment authorization:** existing related suites executed but many failures were due to test/API mismatches or unrelated service-contract issues (see above), so they do not provide clean verification evidence.

**No tests were modified.**

---

## 5. API compatibility results

### 5.1 Order messages API (`app/api/orders/[orderId]/messages/route.ts`, `lib/chat/service.ts`)

| Case | Static verification result | Evidence |
|---|---|---|
| Existing sender | **Compatible by inspection** | `getMessages`/`sendMessage` include `sender: { select: { id, name, image } }`; route returns `result.messages` / created `message` including sender relation. |
| Deleted sender / missing sender relation | **Compatible by inspection (shape), runtime unverified** | Prisma relation is optional (`User?` in schema intent) and selected as relation object; service emits/returns `sender: message.sender` and `senderId: message.senderId` without dereferencing sender fields except notification label fallback (`message.sender?.name ?? DELETED_USER_LABEL`). Clients/types now accept `sender: null` / `senderId: null`. No live API execution against null-sender DB rows. |
| Nullable sender ID | **Compatible by inspection** | Payload includes raw `senderId` from message record; no non-null assumption in route/service serialization. |
| Permissions (customer/booster/admin) | **Enforced by inspection** | GET/POST require authenticated session (`getSessionUser`), call `canAccessConversation(user.id, user.role ?? "CUSTOMER", orderId)` and return `403` when unauthorized. `canAccessConversation` allows order owner, admin, or active assigned/accepted/in-progress/paused booster; denies otherwise. |
| Ownership checks vs null senderId | **No bypass found** | Access control is based on conversation/order/assignment authorization, not historical `message.senderId`. Read-marking uses `senderId: { not: userId }` (query filter), which does not grant access. |

### 5.2 Support messages/ticket APIs (`app/api/support/tickets/[ticketId]/route.ts`, `app/api/support/tickets/[ticketId]/messages/route.ts`, `lib/support/service.ts`)

| Case | Static verification result | Evidence |
|---|---|---|
| Existing sender | **Compatible by inspection** | `getSupportTicket`/`addSupportMessage` include `sender: { select: { id, name, image } }`; routes return ticket/message payloads. |
| Deleted sender / missing sender relation | **Compatible by inspection (shape), runtime unverified** | Nullable sender fields are returned as selected; service emits realtime payload with `sender`/`senderId` without dereferencing. UI types/guards updated. No live execution with null-sender DB rows. |
| Nullable sender ID | **Compatible by inspection** | `senderId` passed through in API/service/realtime payloads. |
| Permissions (customer/admin) | **Enforced by inspection** | Ticket GET/detail: `getSupportTicket` returns ticket only for admin or owning customer (`ticket.customerId !== userId` => null). Message POST: requires auth, fetches ticket via `getSupportTicket` (404 if inaccessible), allows only admin or ticket customer (`isAdmin || isCustomer`), applies rate limit/validation, sets `isAdminReply` from server-side admin role. Ticket list/create/status/assign routes enforce session and role-specific rules. |
| Booster access | **Not a supported role in support ticket service/API by design** | Support access is customer-owner or admin; boosters are not granted ticket access via sender/message ownership. |

---

## 6. Socket.IO compatibility results

| Area | Static verification result | Evidence / limitation |
|---|---|---|
| Server auth/room authorization | **Authorization independent of historical message ownership (inspection)** | `lib/socket/server.ts` authenticates sockets, joins user/role rooms, authorizes `join:order` via DB order owner or active assignment (`ASSIGNED/ACCEPTED/IN_PROGRESS/PAUSED`) or admin, and `join:ticket` via ticket customer, admin, or assigned admin. No checks use `message.senderId`. |
| `message:new` payload | **Nullable-sender compatible by inspection** | `lib/chat/service.ts` emits `senderId: message.senderId`, `sender: message.sender` with other fields; `lib/socket/server.ts` `emitOrderMessage` broadcasts to `order:${orderId}` room. Client `lib/socket/client.tsx` types accept `senderId: string | null`, `sender?: {...} | null`. |
| `support:message:new` payload | **Nullable-sender compatible by inspection** | `lib/support/service.ts` emits `senderId`, `sender`, `isAdminReply`, etc. to `ticket:${ticketId}`; client types accept nullable sender fields. |
| Client handling (order chat) | **Compatible by inspection** | `OrderChat.tsx` stores messages, filters incoming socket messages by id and `sm.senderId !== currentUserId` (safe with null), renders `sender?.image` guarded and `sender?.name ?? DELETED_USER_LABEL`, preserves content/timestamps/read UI. |
| Client handling (support detail) | **Compatible by inspection** | `SupportTicketDetail.tsx` appends unique socket messages, guards avatars with `message.sender?.image`, renders `message.sender?.name ?? DELETED_USER_LABEL`. |
| Reassignment/revocation | **Independent of historical messages by inspection; runtime unverified** | `revokeOrderAccess(userId, orderId)` removes user sockets from order room and clears authorized set; `join:order` re-checks active assignment/order access. Service emits revocations on assignment transitions (per `lib/assignments/service.ts`). No reliance on old message sender IDs. |
| Unauthorized receipt of historical/new messages | **Mitigated by design, runtime unverified** | Historical messages fetched only via authorized HTTP APIs; realtime messages emitted to authorized rooms. However, no runtime/integration socket tests were executed in this environment to prove delivery isolation. |
| Deleted sender runtime rendering | **Not runtime-verified** | No automated/manual execution against live socket events carrying `sender: null`. |

---

## 7. Security regression results

| Check | Result | Evidence / limitation |
|---|---|---|
| Deleted users cannot access former conversations | **Not runtime-verified; access control does not depend on message sender nullability** | Auth/session required for APIs and socket auth (`getSessionUser` / token verification). A deleted user would lack valid active session/identity in normal flows; this specific deleted-user session scenario was not executed. |
| Previous booster cannot regain access through historical messages | **Supported by static authorization design; runtime unverified** | Order chat/support room access is recalculated from current order ownership, active assignment state, ticket ownership/admin assignment, and role — never from historical message sender fields. `revokeOrderAccess` removes room membership on reassignment/removal flows. No end-to-end socket test executed. |
| Historical messages remain visible to currently authorized participants | **Expected by inspection; runtime unverified** | Message queries return all conversation/ticket messages by conversation/ticket scope with sender relation included; nullable sender rendering handled in UI. No live null-sender DB verification. |
| Null sender never bypasses conversation authorization | **Pass by inspection** | Authorization gates occur before message fetch/send (`canAccessConversation`, support ticket access checks, socket join checks). Sender nullability is not used as an allow condition. |
| Message ownership checks do not assume `senderId` is non-null | **Mostly safe with noted behavior** | UI `isOwn` uses `message.senderId === currentUserId` (null-safe comparison, will not mark deleted-sender messages as own). Read/unread logic uses `senderId: { not: userId }` in Prisma filters (messages with null senderId are treated as not sent by current user and may be considered unread/markable-read depending on query semantics) — no authorization bypass identified, but behavior is **not runtime-verified**. |

---

## 8. Remaining issues

1. **Full TypeScript check not clean:** `npx tsc --noEmit` fails with 2 pre-existing/unrelated parse errors in `__tests__/security/sanitize.test.ts` (lines 28:33, 28:35).
2. **No runtime/integration verification for null-sender DB records:** DB schema/data changes remain unapplied; APIs/sockets/UI were not exercised against actual `sender: null` / `senderId: null` message rows.
3. **Relevant automated coverage incomplete or inconclusive:** no dedicated order-chat/support-message API or socket-event runtime tests for deleted-sender payloads; notification rendering/creation for deleted-sender order messages not executed as a suite.
4. **Executed existing suites include failures unrelated to nullable sender compatibility but block a clean green verification signal:** `support/ticket-transitions.test.ts` failed due missing `isomorphic-dompurify` resolution in test environment; `socket/auth.test.ts`, `socket/room-auth.test.ts`, and `assignments/reassignment-revocation.test.ts` fail due test/API/contract mismatches; `assignments.service.test.ts` has 2 failing tests (contract/mock behavior) with 20 passing.
5. **ESLint/build not fully completed in this verification run:** modified-file ESLint was started earlier but terminated by tool timeout (120000 ms) without a final exit code captured in this report; `next build` was not executed (environment/time cost and not completed here).
6. **Potential read-state semantics for null `senderId`:** `markMessagesAsRead`/unread-count queries filter `senderId: { not: userId }`; if a historical message has `senderId = null`, it will not be treated as authored by the current user (safe for authorization) but may affect read/unread behavior — requires runtime confirmation.

---

## 9. Explicit limitations

- **Static inspection vs runtime:** Socket delivery, UI rendering, and API responses for deleted-sender messages were verified primarily by code inspection; runtime behavior is **not** claimed verified without execution.
- **No database writes/reads against migrated nullable columns:** Prisma DB changes remain unapplied (`OrderMessage.senderId`, `SupportMessage.senderId` nullable with `ON DELETE SET NULL`; notification FK pending per prior readiness context), so no live verification with actual nullified sender relations was possible.
- **Test environment/tooling constraints:** Vitest emitted `configLoader: 'native'` warning for `vitest.config.ts`; `isomorphic-dompurify` could not be resolved in `ticket-transitions` suite run; full modified-file ESLint command timed out (120000 ms) without captured completion; build not run.
- **Workspace state:** working tree contains many pre-existing modified/untracked files unrelated to this verification; only this report file was added during verification.
- **Authorization conclusions:** Based on current implementation inspection (DB-backed access checks, room authorization, revocation paths). No penetration/runtime exploit testing was performed.

---

## Final decision

`APPLICATION COMPATIBILITY NOT VERIFIED`
