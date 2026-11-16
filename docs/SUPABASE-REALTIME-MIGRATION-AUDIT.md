# Supabase Realtime Migration Audit — LegendsBoost

**Project:** LegendsBoost  
**Phase:** 0 — Repository & Architecture Audit (MANDATORY)  
**Status:** Complete — no code changes made yet  
**Date:** 2026-11-10

---

## 1. Executive Summary

LegendsBoost currently runs a **custom Socket.IO server** for real-time order chat, support chat, notifications, and presence. The Socket.IO server is initialized inside a custom Node.js HTTP server (`server.ts`) that wraps the Next.js request handler. Authentication is handled by **Auth.js / NextAuth** (JWT strategy), not Supabase Auth. Prisma + PostgreSQL (hosted on Supabase via the connection pooler) is the source of truth.

There is **no existing Supabase Realtime integration**. The `.env` contains `DATABASE_URL`/`DIRECT_URL` (Supabase Postgres pooler) and Auth.js secrets, but no `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_JWT_SECRET`. The `@supabase/supabase-js` package is **not installed**.

This audit documents the existing architecture, authorization rules, event types, API endpoints, UI components, security risks, and the proposed migration sequence. **No Socket.IO code has been deleted.**

---

## 2. Existing Real-Time Architecture

### 2.1 Transport

- **Socket.IO server** — `lib/socket/server.ts`
  - Created once in `server.ts` via `initializeSocketServer(httpServer)`.
  - `instrumentation.ts` is a **no-op** (Socket.IO is managed by `server.ts`, not the Next.js instrumentation hook).
  - Path: `/api/socket`, transports: websocket + polling.
  - In-memory connection tracking: `userSockets` (userId → Set<socketId>) and `socketRooms` (socketId → order/ticket rooms).
- **Socket.IO client** — `lib/socket/client.tsx` (`useSocket` hook), `socket.io-client` v4.
- **Entrypoint** — `scripts` in `package.json`: `dev`/`start` run `tsx server.ts` (custom server), **not** `next dev`/`next start`. Build: `prisma generate && next build`.

### 2.2 Authentication Bridge (existing)

- `POST /api/socket/auth` — validates the NextAuth session (`getServerSession(authOptions)`), issues a short-lived (15 min) JWT signed with `SOCKET_SECRET` via `jose` (`lib/socket/token.ts`).
- `lib/socket/auth.ts` (`instrumentSocket`) — Socket.IO middleware verifies the JWT, loads the authoritative `role` from `prisma.user`, attaches `socket.userId`/`userRole`/`user`. Rejects unauthenticated connections.
- Client obtains the token by calling `/api/socket/auth` with credentials cookie (`credentials: "include"`).

### 2.3 Channels / Rooms

| Room name | Purpose | Authorized joiners (server-side check) |
|-----------|---------|----------------------------------------|
| `order:{orderId}` | Order chat | Order customer, assigned booster (active assignment), admin |
| `ticket:{ticketId}` | Support chat | Ticket customer, any admin |
| `user:{userId}` | Personal notifications | Socket server emits here; no client join enforcement |

### 2.4 Events (Socket.IO)

| Event | Direction | Payload |
|-------|-----------|---------|
| `message:new` | server → order room | OrderMessage shape |
| `support:message:new` | server → ticket room | SupportMessage shape |
| `notification:new` | server → user room | Notification shape |
| `notification:count` | server → user room | `{ count: 1, increment: true }` |
| `access:revoked` | server → socket | `{ type: "order", orderId }` |
| `join:order` / `leave:order` | client → server | orderId + callback |
| `join:ticket` / `leave:ticket` | client → server | ticketId + callback |
| `message:send` | client → server | (exposed on hook, unused by OrderChat) |
| `support:message:send` | client → server | (exposed on hook, unused by SupportTicketDetail) |

### 2.5 Broadcast helpers (`lib/socket/server.ts`)

- `emitOrderMessage(orderId, message)` — `io.to(order:orderId).emit("message:new", ...)`
- `emitSupportMessage(ticketId, message)` — `io.to(ticket:ticketId).emit("support:message:new", ...)`
- `emitNotification(userId, notification)` — emits `notification:new` + `notification:count` to `user:userId`
- `revokeOrderAccess(userId, orderId)` — kicks sockets out of an order room on reassignment/complete/cancel/release/abandon

---

## 3. Existing Authentication Flow

- **Auth.js / NextAuth** (`auth.ts`, `app/api/auth/[...nextauth]/route.ts`)
  - Providers: Google OAuth + Credentials (email/password).
  - Session strategy: **JWT**.
  - Callbacks populate `token.id` and `token.role` from `prisma.user` on sign-in; session exposes `user.id` and `user.role`.
  - `types/next-auth.d.ts` augments `next-auth` and `next-auth/jwt` with `id` and `role`.
- **Server-side session helpers** — `lib/auth/guards.ts` (`getSessionUser`, `requireAuth`, `requireRole`, `requireAnyRole`, `requireCustomer`, `requireBooster`, `requireAdmin`), `lib/auth/current-user.ts`, `lib/dashboard/get-dashboard-context.ts`.
- **Session validation in API routes** — every mutation API calls `getSessionUser()` and returns 401/403 as appropriate.

**Auth.js must remain in place.** It is not replaced by Supabase Auth.

---

## 4. Existing Database Models (Prisma schema: `prisma/schema.prisma`)

Provider: `postgresql`. Output: `app/generated/prisma`. Key models:

| Model | Relevant fields |
|-------|-----------------|
| `User` | `id` (cuid), `email` (unique), `role` (ADMIN/BOOSTER/CUSTOMER), `passwordHash`, `createdAt`, `updatedAt` |
| `Account`, `Session`, `VerificationToken` | NextAuth adapter models |
| `CustomerProfile` | `userId` (unique) |
| `BoosterProfile` | `userId` (unique), `verificationStatus` (PENDING/APPROVED/REJECTED/SUSPENDED), `availabilityStatus` |
| `Order` | `id`, `userId`, `gameSlug`, `serviceSlug`, `status` (PENDING/IN_PROGRESS/PAUSED/COMPLETED/CANCELLED), `price`, `createdAt`, `updatedAt` |
| `OrderEvent` | `orderId`, `type`, `message`, `metadata`, `createdAt` |
| `OrderBoosterAssignment` | `orderId`, `boosterId`, `assignedById`, `status` (ASSIGNED/ACCEPTED/IN_PROGRESS/PAUSED/COMPLETED/DECLINED/CANCELLED/RELEASED), `activeOrderId` (unique), `assignedAt`/`endedAt` |
| `Notification` | `id`, `userId`, `type` (enum), `title`, `message`, `orderId` (nullable), **`read`** (default false), **`readAt`** (nullable), `metadata`, `createdAt` |
| `OrderConversation` | `id`, `orderId` (unique), `closedAt`, `createdAt`, `updatedAt` |
| `OrderMessage` | `id`, `conversationId`, `senderId` (nullable), `content`, `messageType`, **`readAt`** (nullable), `createdAt` |
| `SupportTicket` | `id`, `customerId`, `orderId` (nullable), `subject`, `description`, `category`, `priority`, `status` (OPEN/IN_PROGRESS/WAITING_FOR_CUSTOMER/RESOLVED/CLOSED), `assignedAdminId` (nullable), `createdAt`, `updatedAt`, `resolvedAt` |
| `SupportMessage` | `id`, `ticketId`, `senderId` (nullable), `content`, `isAdminReply`, `createdAt` |

### Important finding — read receipts
`OrderMessage` already has a `readAt` field and `markMessagesAsRead` / `getUnreadMessageCount` already exist in `lib/chat/service.ts`. **No schema change is required for order-message read receipts.** There is no equivalent read-receipt field on `SupportMessage` (would need schema change if support read receipts are required).

Table names (via `@@map`): `user`, `account`, `session`, `customerProfile`, `boosterProfile`, `order`, `orderEvent`, `orderBoosterAssignment`, `notification`, `orderConversation`, `orderMessage`, `supportTicket`, `supportMessage`. Prisma model names mostly match table names (case differs), but this must be verified per-model when writing SQL policies.

Migration history: 8 migrations under `prisma/migrations/` (no `migrate reset`/`db push`/historical edits permitted).

---

## 5. Existing Authorization Rules

### 5.1 Order conversation access (`lib/chat/service.ts:canAccessConversation`)
Allowed if:
- `order.userId === userId` (customer), OR
- `userRole === "ADMIN"`, OR
- user has an active assignment (`status` in `[ASSIGNED, ACCEPTED, IN_PROGRESS, PAUSED]`) with `boosterId === userId`.

Denied otherwise (unassigned booster, unrelated customer, non-existent order).

### 5.2 Support ticket access (`lib/socket/server.ts:canAccessTicket`)
Allowed if:
- `ticket.customerId === userId`, OR
- `userRole === "ADMIN"` (any admin, any ticket).

### 5.3 Assignment operations (`lib/assignments/service.ts`)
- Booster must be `BOOSTER` role with `boosterProfile.verificationStatus === "APPROVED"` (PENDING/REJECTED/SUSPEND rejected).
- Admin can claim/pause/resume/complete/cancel/release/accept/start/reassign any booster's assignment.
- Non-admin boosters can only act on their own assignments.
- `reassignOrder` is admin-only; releases the current active assignment and creates a new one.

### 5.4 Notification recipients (`lib/notifications/service.ts:getRecipientRules`)
Per-event-type recipient rules (order customer, assigned booster, admins, ticket customer, assigned admin). `createNotification` self-notifies only if `actorId !== userId`.

### 5.5 API route guards
All mutation APIs use `getSessionUser()` / `getSessionUser` + role checks. Resource ownership is checked in services (e.g. `getSupportTicket` returns null if not customer/admin).

**Gaps:**
- No **channel-level** transport authorization exists today (Socket.IO `join:` callbacks do the check, but there is no reusable authorization service independent of the socket server).
- Rate limiting is **in-memory** (`lib/rate-limit.ts`, `lib/security/sanitize.ts` `checkRateLimit`), not safe for multi-instance deployment.

---

## 6. Existing Event Types

### 6.1 Notification types (`NotificationType` enum)
`ORDER_CREATED`, `ORDER_CANCELLED`, `ORDER_STARTED`, `ORDER_PROGRESS_UPDATED`, `ORDER_COMPLETED`, `ORDER_REOPENED`, `BOOSTER_ASSIGNED`, `BOOSTER_ACCEPTED`, `BOOSTER_REJECTED`, `BOOSTER_REASSIGNED`, `BOOSTER_REMOVED`, `BOOSTER_ABANDONED`, `NEW_MESSAGE`, `SUPPORT_REPLY`, `SUPPORT_STATUS_UPDATED`, `SUPPORT_TICKET_CREATED`, `SUPPORT_TICKET_RESOLVED`.

### 6.2 Order event types (`OrderEvent.type`, free text)
`ORDER_CREATED`, `BOOSTER_ASSIGNED`, `WORK_STARTED`, `ORDER_PAUSED`, `ORDER_RESUMED`, `COMPLETION_SUBMITTED`, `ORDER_COMPLETED`, `ORDER_CANCELLED`, `CUSTOMER_CONFIRMED`, plus legacy `ORDER_CLAIMED`, `ASSIGNMENT_ACCEPTED`, `ASSIGNMENT_STARTED`, `ASSIGNMENT_COMPLETED`, `ASSIGNMENT_CANCELLED`, `ASSIGNMENT_RELEASED`, `ASSIGNMENT_DECLINED`.

### 6.3 Proposed real-time event taxonomy (Phase 2)
Chat: `chat.message.created`, `chat.message.read`, `chat.typing.started`, `chat.typing.stopped`, `chat.presence.changed`  
Notifications: `notification.created`, `notification.read`, `notification.all_read`, `notification.unread_count_changed`  
Orders: `order.created`, `order.assigned`, `order.reassigned`, `order.started`, `order.status_changed`, `order.completed`, `order.cancelled`  
Support: `support.message.created`, `support.ticket.updated`, `support.ticket.assigned`, `support.ticket.closed`

Existing names (e.g. `BOOSTER_ASSIGNED`, `NEW_MESSAGE`) should be preserved where established and mapped to the new taxonomy rather than invented.

---

## 7. Existing API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/socket` | GET | Socket.IO health | None |
| `/api/socket/auth` | POST | Issue Socket.IO JWT | NextAuth session (cookie) |
| `/api/orders/[orderId]/messages` | GET/POST | Order message history / send | Session + `canAccessConversation` + rate limit |
| `/api/notifications` | GET | List notifications | Session |
| `/api/notifications/[id]` | PATCH | Mark one read | Session + ownership |
| `/api/notifications/read-all` | POST | Mark all read | Session |
| `/api/support/tickets/[ticketId]/messages` | POST | Send support message | Session + ticket access + rate limit |
| `/api/support/tickets` | POST | Create ticket | Session + rate limit |
| `/api/support/tickets/[ticketId]` | PATCH | Update status / assign | Session + admin |
| `/api/booster/orders/[orderId]/claim` | POST | Claim order | Session + BOOSTER |
| `/api/booster/orders/[orderId]/accept` | POST | Accept assignment | Session + BOOSTER |
| `/api/booster/orders/[orderId]/start` | POST | Start work | Session + BOOSTER |
| `/api/booster/orders/[orderId]/pause` | POST | Pause | Session + BOOSTER/Admin |
| `/api/booster/orders/[orderId]/resume` | POST | Resume | Session + BOOSTER/Admin |
| `/api/booster/orders/[orderId]/complete` | POST | Complete | Session + BOOSTER/Admin |
| `/api/booster/orders/[orderId]/release` | POST | Release | Session + BOOSTER/Admin |
| `/api/booster/orders/[orderId]/cancel` | POST | Cancel | Session + BOOSTER/Admin |
| `/api/booster/orders/[orderId]/decline` | POST | Decline | Session + BOOSTER |
| `/api/orders/[orderId]` | GET/PATCH | Order detail | Session |
| `/api/orders` | POST | Create order | Session |
| `/api/orders/draft` | POST | Draft order | Session |

All order/lifecycle/support APIs call through `lib/assignments/service.ts`, `lib/chat/service.ts`, `lib/support/service.ts`, `lib/notifications/service.ts`.

---

## 8. Existing UI Components

| Component | Path | Real-time dependency |
|-----------|------|----------------------|
| `OrderChat` | `components/chat/OrderChat.tsx` | `useSocket` — joins `order:{orderId}`, listens `message:new`, recovers history on reconnect |
| `OrderWorkspace` | `components/orders/workspace/OrderWorkspace.tsx` | Wraps `OrderChat`; passes `initialMessages`, `conversation` |
| `NotificationCenter` | `components/notifications/NotificationCenter.tsx` | `useSocket` — listens `notification:new`/`notification:count` |
| `NotificationBell` | `components/notifications/NotificationBell.tsx` | `useSocket` — unread badge + dropdown |
| `SupportTicketDetail` | `components/support/SupportTicketDetail.tsx` | `useSocket` — joins `ticket:{ticketId}`, listens `support:message:new` |
| `DashboardShell` | `components/dashboard/DashboardShell.tsx` | Renders `NotificationBell` with `initialUnreadCount` |
| `AvailableOrdersClient` | `app/dashboard/booster/available-orders/AvailableOrdersClient.tsx` | Claims orders via REST; no real-time |
| `ClaimedOrdersClient` | `app/dashboard/booster/claimed-orders/ClaimedOrdersClient.tsx` | Lists assignments; no real-time |
| Order detail pages | `app/dashboard/[orderId]/page.tsx` | SSR fetches conversation + messages; passes to `OrderWorkspace` |

Pages using `useSocket`: `OrderChat`, `NotificationCenter`, `NotificationBell`, `SupportTicketDetail`. All four import `useSocket` from `@/lib/socket/client`.

---

## 9. Broken or Incomplete Functionality

| Area | Issue |
|------|-------|
| Transport | Custom Socket.IO + custom `server.ts`; not compatible with stock `next dev`/`next start`. Edge-runtime incompatible (`node:http`). |
| Typing indicators | Do not exist. |
| Presence | Does not exist. |
| Read receipts | Order messages have `readAt` and are marked read on history GET (aggressive — marks all unread messages read when history is fetched). No real-time read-receipt broadcast. No support-message read receipts. |
| Reconnection recovery | Chat re-fetches REST history on `reconnect`/`connect` (best-effort, swallows errors). Notifications do not recover missed events. |
| Rate limiting | In-memory `Map` — not shared across instances; resets on restart. |
| Channel authorization | Transport-level checks exist only inside Socket.IO join callbacks; no reusable, testable channel-authorization service. |
| Broadcast reliability | `emit*` functions are fire-and-forget; if the Socket.IO server is not initialized, the broadcast is silently dropped (message still persisted). |
| Duplicate notifications | Multiple notification recipient rules could overlap; no dedup at create time. |
| `getMessages` pagination | Page/skip-based, not cursor-based; `before` uses `createdAt` only (no unique tie-breaker). |

---

## 10. Files That Can Be Reused

| File | Reuse |
|------|-------|
| `lib/chat/service.ts` | Validation, sanitization, `sendMessage`, `markMessagesAsRead`, `canAccessConversation`, `getOrCreateConversation`, `getMessages`. Keep DB logic; replace `emitOrderMessage` call with Supabase broadcast. |
| `lib/support/service.ts` | `addSupportMessage`, `createSupportTicket`, ticket status/assignment, rate limiting, sanitization. Replace `emitSupportMessage`. |
| `lib/notifications/service.ts` | `createNotification`, `createNotificationsForEvent`, recipient rules, `markAsRead`, `markAllAsRead`, `getNotifications`, `getUnreadCount`. Replace `emitNotification`. |
| `lib/assignments/service.ts` | All assignment lifecycle logic. Replace `revokeOrderAccess(...)` calls with Supabase-based access revocation. |
| `lib/security/sanitize.ts` | `sanitizeText`, `sanitizeHtml`, rate-limit configs (`MESSAGE_RATE_LIMIT`, `SUPPORT_MESSAGE_RATE_LIMIT`, `SUPPORT_TICKET_RATE_LIMIT`). |
| `lib/rate-limit.ts` | Reference implementation; **must be replaced** with a shared/distributed mechanism for production. |
| `lib/auth/*` | `getSessionUser`, `requireAuth`, `requireRole`, `getCurrentUser`, role helpers — used for the Realtime token bridge. |
| `lib/auth/permissions.ts` | `UserRole`, `hasRole`, `isAdmin`, `isBooster`, `isCustomer`. |
| `prisma/schema.prisma` | Reuse as-is (no model additions required for order chat read receipts — `readAt` exists). |
| `types/next-auth.d.ts` | Session/JWT type augmentation — reused. |
| UI components (`OrderChat`, `NotificationCenter`, `NotificationBell`, `SupportTicketDetail`, `OrderWorkspace`, `DashboardShell`) | Preserve styling/structure; swap `useSocket` for new Supabase Realtime hooks. |

---

## 11. Files That Should Be Replaced

| File | Replacement |
|------|-------------|
| `lib/socket/server.ts` | `lib/realtime/subscriptions.ts` + broadcast service (Supabase Realtime channels, presence, broadcast) |
| `lib/socket/auth.ts` | `lib/supabase/realtime-auth.ts` (Auth.js session → Supabase Realtime JWT bridge) |
| `lib/socket/token.ts` | Removed (SOCKET_SECRET JWT replaced by Supabase Realtime JWT signed with `SUPABASE_JWT_SECRET`) |
| `lib/socket/client.tsx` | `lib/realtime/` hooks (`useOrderRealtime`, `useUserNotifications`, `usePresence`, `useTypingIndicator`, `useSupportRealtime`) |
| `app/api/socket/route.ts` | Removed |
| `app/api/socket/auth/route.ts` | `app/api/realtime/auth/route.ts` (or similar) — issues short-lived Realtime JWT after channel authorization |
| `server.ts` | Remove `initializeSocketServer` call; keep Next.js handler |
| `instrumentation.ts` | No change (already no-op) |

---

## 12. Security Risks

1. **Custom transport + custom auth** — Socket.IO auth JWT signed with `SOCKET_SECRET`; no channel-level transport authorization outside join callbacks.
2. **`SOCKET_SECRET` present in `.env`** (real value) — must be rotated/removed after migration.
3. **In-memory rate limiting** — not multi-instance safe; brute-force possible across instances.
4. **Aggressive read-on-fetch** — GET `/api/orders/[orderId]/messages` marks all conversation messages as read for the requesting user, even messages they never viewed.
5. **`extractTokenFromHandshake`** falls back to the NextAuth session cookie; verification rejects it (not signed with `SOCKET_SECRET`), but the fallback is confusing and unnecessary.
6. **No presence/typing** — absence means users cannot tell if the other party is online or typing.
7. **Broadcast fire-and-forget** — no retry/confirmation; silent drop if IO not initialized.
8. **No Supabase Realtime config** — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` are not configured yet (see section 14).

---

## 13. Required Environment Configuration

The following must be added (names only; values must come from the Supabase project dashboard, never committed):

- `SUPABASE_URL` — Supabase project URL (browser + server)
- `SUPABASE_ANON_KEY` — Supabase anon/public key (browser + server)
- `SUPABASE_JWT_SECRET` — Supabase project JWT secret (**server only**) — used to sign short-lived Realtime JWTs that Supabase Realtime validates. Obtain from Supabase Dashboard → Settings → API → JWT secret. Never expose to browser.
- `SUPABASE_SERVICE_ROLE_KEY` — (**server only**) for privileged server operations; never exposed to browser.

Existing variables retained: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `RIOT_LOL_API_KEY`.

To remove after migration: `SOCKET_SECRET` (and its usages in `lib/socket/token.ts`, `lib/socket/auth.ts`, tests).

---

## 14. Supabase Realtime Signing Investigation — FINDING

**Finding: No Supabase Realtime configuration exists in this repository.**

- `.env` / `.env.example` contain **no** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_JWT_SECRET`.
- `@supabase/supabase-js` and `@supabase/realtime-js` are **not installed** (confirmed via `node_modules` check).
- The application connects to Supabase **Postgres only** (via `DATABASE_URL` pooler); Auth.js handles authentication.

**Supported approach (to implement):**
Supabase Realtime (managed) validates client JWTs against the project's **JWT secret** (`SUPABASE_JWT_SECRET`). Since Auth.js remains the auth system, the bridge is:

1. Server validates the Auth.js session (`getServerSession` / `getSessionUser`).
2. Server performs channel-level authorization (order/ticket/user access rules).
3. Server signs a short-lived JWT with `SUPABASE_JWT_SECRET` containing `sub: userId`, `role: "authenticated"`, `exp` (short, e.g. 15 min), `iat`.
4. Client passes this JWT to Supabase Realtime when subscribing to `private-*` channels.

**Important limitation of managed Supabase Realtime:** For **broadcast/presence** on `private-*` channels, managed Realtime enforces **authentication only** (any valid JWT can join any `private-*` channel). It does **not** enforce per-channel ACL natively (that requires self-hosted Realtime authorization hooks / enterprise features).

**Defense-in-depth design (mitigates the limitation):**
- The Realtime token endpoint performs per-channel authorization **before issuing a token** (e.g. `canAccessOrder` for `order:{orderId}`).
- The server performs authorization **before every broadcast** (it controls who receives what).
- Broadcasts contain **only references** (ids/types), not private payloads; clients fetch details via protected APIs that re-authorize.
- Clients subscribe only to channels they were authorized for via the token endpoint.

If the Supabase project does not expose `SUPABASE_JWT_SECRET` or does not permit custom-signed Realtime JWTs, the supported alternative is to document it here and **not** implement an insecure workaround (e.g. not trusting browser-supplied user IDs, not skipping channel authorization).

---

## 15. Proposed Migration Sequence

| Phase | Work | Verification gate |
|-------|------|-------------------|
| 0 | **Audit** (this document) — inspect all dependencies, produce audit | Audit reviewed |
| 1 | **Supabase Realtime foundation** — install `@supabase/supabase-js`, create `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/realtime-auth.ts`, `lib/realtime/channel-names.ts`, `lib/realtime/events.ts`, `lib/realtime/broadcast.ts`, `lib/realtime/subscriptions.ts`; add env vars | Typecheck + lint pass; no runtime breakage (Socket.IO still active) |
| 2 | **Event architecture** — centralized typed events, broadcast service, persist-before-broadcast | Unit tests for event validation |
| 3 | **Order chat** — messages, typing, read receipts, presence over Supabase Realtime | Integration tests: customer↔booster chat |
| 4 | **Notifications** — broadcast `notification.created` to `user:{userId}`, unread count, mark-as-read | Integration tests |
| 5 | **Order updates** — status/assignment events to dashboards; revoke previous booster access | Integration tests: reassignment revocation |
| 6 | **Support** — support ticket real-time over `support:{ticketId}` | Integration tests |
| 7 | **Frontend integration** — new hooks + updated components, preserve UI | Manual UI verification |
| 8 | **Remove Socket.IO** — delete `lib/socket/*`, `app/api/socket/*`, `server.ts` socket init, `socket.io`/`socket.io-client` deps | Build passes; no Socket.IO imports remain |
| 9 | **Automated testing** — auth/channel authorization, chat, notifications, orders, support tests | Test suite passes |
| 10 | **Quality gates** — typecheck, lint, tests, prisma validate, build, security review | All gates pass |

**Rule:** Do not delete Socket.IO code until Phase 8, and only after the Supabase Realtime implementation is working and tested. Do not run `prisma migrate reset`, `prisma db push`, or edit historical migrations.

---

## 16. Known Database Change Needs

- **Order chat read receipts:** `OrderMessage.readAt` exists → **no change required**.
- **Support message read receipts:** `SupportMessage` has no `readAt`. If support read receipts are required, a forward-only migration adding `readAt` to `supportMessage` is needed (explain impact, backfill, rollback before applying).
- **Presence:** Ephemeral, stored only in Supabase Realtime (memory), not in PostgreSQL → **no schema change**.
- **Typing indicators:** Ephemeral broadcast only → **no schema change**.

No changes to historical migrations. Any new schema change requires a new forward-only migration file, reviewed before application to shared/production databases.

---

## 17. Immediate Next Step

Proceed to **PHASE 1** — install `@supabase/supabase-js` and create the Supabase foundation files. No existing files are modified or deleted in this phase.
