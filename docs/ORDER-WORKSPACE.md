# Order Workspace

One page per order, shared by the customer, the assigned booster and admins:
`/dashboard/{orderId}` (alias `/dashboard/orders/{orderId}`). The customer and
booster routes `/dashboard/{customer,booster}/orders/{id}` redirect there.

## Access (server-enforced)

`lib/orders/workspace-access.ts` → `resolveWorkspaceAccess()` is the single
policy used by the page and every workspace API route (`guardWorkspace`).

| Viewer | Access |
| --- | --- |
| Customer | Only orders they own. Can edit the Riot ID/region (until the progress baseline is captured), pause/resume their in-progress order, sync, chat. |
| Booster | Only while holding the **active** assignment (`activeOrderId = order.id`) and only if their profile is `APPROVED`. Can complete/abandon (never while the customer has the order paused), sync, chat. After completing, read-only with no chat. Released/abandoned boosters lose access. |
| Admin | Every order. Edits and republishes only `DRAFT` orders. |

Everyone else gets **404**, so the existence of other orders isn't disclosed.

## Layout

Fixed-viewport workspace (no page scrolling). See `docs/ORDER-WORKSPACE-UI-REDESIGN.md` for the full layout, breakpoints and browser test results.

- xl (≥1280px): left (order info, Riot account, champions & roles) · center (current → progress → target rank) · right (`OrderChat`), with match history full-width below.
- lg (1024–1279px): rank + details column and chat column, match history below.
- Below lg: tabs (Overview / Chat / Matches).

The order activity timeline and manual rank reporting were removed (Nov 2026). The chat is the existing `components/chat/OrderChat.tsx`; it also forwards order lifecycle broadcasts so the workspace refreshes immediately when the other participant pauses/resumes/completes. `GET /api/orders/{id}/status` (every 15s while visible) remains the fallback.

## Lifecycle

```
PENDING --booster claims--> IN_PROGRESS
IN_PROGRESS --customer pauses--> PAUSED --customer resumes--> IN_PROGRESS   (booster notified)
IN_PROGRESS --booster completes--> COMPLETED (customer + booster + admins notified, once)
IN_PROGRESS --booster abandons--> DRAFT      (admins + customer notified; NOT on the marketplace)
DRAFT --admin edit--> DRAFT                  (DRAFT_EDITED audit event with previous values)
DRAFT --admin republish--> PENDING           (ORDER_REPUBLISHED; customer notified)
```

- Boosters have exactly three actions: claim, complete, abandon. Complete and abandon are rejected (409) while the order is PAUSED. The booster pause/resume/accept/start/decline routes were removed; `release` is admin-only.
- `DRAFT` can't be claimed: `claimOrder` requires `PENDING`, and the marketplace lists only `PENDING`.
- Completion uses a conditional update (`status = IN_PROGRESS`), so a concurrent second completion rolls back. The notification uses `dedupeKey = ORDER_COMPLETED:{orderId}`, protected by the unique index `notification(userId, dedupeKey)`.
- Booster action routes now check that the assignment belongs to the URL's order **before** mutating.

## Riot integration

Code lives in `lib/services/games/league-of-legends/`:

| File | Purpose |
| --- | --- |
| `routing.ts` | Closed platform → host table (prevents SSRF); Match-V5 regional and Account-V1 cluster routing; unsupported platforms with reasons. |
| `riot-client.ts` | Server-only. `X-Riot-Token` header, zod response validation, typed errors (`kind`), secret-free structured logs, Retry-After + shared cooldown, 5xx backoff, TTL cache, 8s timeout. |
| `rate-limiter.ts` / `shared-client.ts` | App-wide limiter per key fingerprint and routing host, stored in Postgres (`riotApiThrottle`), database clock, fails closed. |
| `riot.schemas.ts` | zod schemas for every Riot response read. |
| `region.service.ts` | Summoner-V4 region confirmation (+ Account-V1 active-region suggestion). |
| `capabilities.ts` | Decides whether any live call is allowed (see below). |
| `account.service.ts` | Account-V1 by Riot ID; Riot ID validation. |
| `rank.service.ts` | League-V4 `entries/by-puuid`. |
| `match-history.service.ts` | Match-V5 ids and details, work windows, attribution (pure). |
| `progression.service.ts` | Rank normalization and progress math (pure, unit-tested). |
| `sync.service.ts` | Orchestrates one incremental sync for an order. |
| `champion-assets.ts` | Champion icons from Riot's public Data Dragon CDN. |

### Live data is OFF by default

`dataAccess` is true only when `RIOT_API_KEY` (or the deprecated fallback `RIOT_LOL_API_KEY`) is set **and** either:

- `RIOT_API_KEY_TIER=production` and `RIOT_PRODUCT_APPROVED=true`, or
- `RIOT_ALLOW_DEV_KEY_LOCAL=true` and `NODE_ENV !== production` (local testing only).

Otherwise the UI says "Official Riot integration pending", and only the ranks declared on the order are shown (labelled "From order"); no current rank is shown.

### What Riot approval is required (from developer.riotgames.com, read 2026-11-12)

- Development keys "deactivate every 24 hours", and "You may not maintain a public product with a development API key." Personal keys may not be used "for public consumption."
- Production keys need an approved product (one product per key).
- **Riot Sign On** "is only available to developers with Production Level API Keys" and is onboarded by Riot. So RSO is **not implemented**: `rso` is always `false`, and accounts are "Identified" (typed Riot ID) or "Found on Riot" (PUUID resolved). Neither status proves ownership.
- General policy: products cannot "create an unfair advantage for players." The docs read have **no explicit boosting clause**, and the approval criteria favour products that help players improve. **The boosting business model must be raised with Riot Developer Relations before applying for or enabling production access.** Holding a key is not authorization.
- Not verified from the docs (the reference pages weren't readable): the exact League-V4 `by-puuid` path and Match-V5 query limits. Both follow the current public reference as best known; verify them against the API explorer before enabling.
- **Never** collect Riot passwords, share logins, automate login, or scrape the client. The Riot ID form says so explicitly.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `RIOT_API_KEY` | Canonical key variable (server-only). `RIOT_LOL_API_KEY` is read only if this is unset. |
| `RIOT_API_KEY_TIER` | `development` (default) / `personal` / `production`. It selects the rate limits and the 403 diagnostic hint. |
| `RIOT_PRODUCT_APPROVED` | `true` only after Riot approved the product for this use. It requires `production`. |
| `RIOT_ALLOW_DEV_KEY_LOCAL` | `true` lets a dev key fetch data when `NODE_ENV !== production` (local testing only). |
| `RIOT_RATE_LIMITS` | Optional override, `max:windowSec,...` (e.g. from the key's `X-App-Rate-Limit` header). 80% of each is used. |

Key tiers (Riot Developer Portal, read 2026-11-12):

- **Development**: deactivates every 24 hours, and may not run a public product. Its rate limits aren't published, so the personal-key limits are assumed.
- **Personal**: 20 requests per second and 100 per 2 minutes. It may not be used "for public consumption".
- **Production**: requires an approved product and "typically" a working prototype. Limits are 500 requests per 10 seconds and 30,000 per 10 minutes.

Limits are enforced per region.

### Regions

The supported platforms are those listed in Riot's docs platform table **and** served by Summoner-V4 and League-V4 `by-puuid`: BR1, EUN1, EUW1, JP1, KR, LA1, LA2, NA1, OC1, RU, SG2, TR1, TW2, VN2.

Not supported:

- **PH2, TH2**: not served by Summoner-V4 or League-V4.
- **ME1**: not in the docs platform table, and Riot doesn't document its Match-V5 routing.

Accounts already stored with one of these are asked to pick a supported region. Riot documents the regional hosts (americas, asia, europe, sea) but no platform-to-region table; it says to "execute a sample request". The mapping in `routing.ts` is Riot's established convention, so **confirm it with one authorized request per region before enabling production**.

### Account identification and region validation

1. The customer enters a Riot ID and a region. Status: `MANUAL`, shown as "Identified (not verified)".
2. On the first sync, Account-V1 resolves the Riot ID to a PUUID. Account-V1 answers for any region, so it doesn't prove the region.
3. Summoner-V4 `by-puuid` on the selected platform must return a profile. A 404 means there's no League profile on that region, so the sync fails with `wrong_region` and an actionable message. Account-V1's "active region" endpoint is only used to suggest the correct region; it never changes it automatically. A Riot ID that doesn't exist fails with `not_found`.
4. Only then is the account marked `RESOLVED` ("Found on Riot in this region (ownership not verified)"). Riot's canonical spelling of the Riot ID is stored.
5. This still doesn't prove **ownership**. That needs RSO, which isn't implemented.

Riot IDs are compared case-insensitively, so changing only the capitalisation isn't treated as an account change.

**Lock** (`lib/orders/riot-account-lock.ts`):

- Customers and boosters can't change or unlink the account once any assignment has started (including released or abandoned ones), or once a baseline exists.
- **Nobody**, admins included, can change it once order matches exist.
- Order matches are never deleted by an account change.
- The lock is checked again inside the write transaction.

### Match synchronization (durable)

**Scan.** For each work window, from `matchScanUntil − 2h` (or from the window start) to now, Match-V5 ids are listed for each queue, paginated with `start`/`count=100` until a short page (cap: 1,000 ids per range).
- New ids are appended to `pendingMatchIds`.
- `matchScanUntil` advances only if the scan completed.
- The 2-hour overlap catches games that were still running, or not yet indexed by Riot, at the previous scan.

**Process.** Up to 20 pending ids are fetched per sync.
- Each match is committed in one transaction together with its removal from the pending list, so a 429, a 5xx or a crash never discards fetched matches.
- Unprocessed ids simply stay pending; the UI shows how many and asks for another sync.
- Duplicates are impossible: ids are de-duplicated against stored and pending ids, and `(orderId, matchId)` is unique.

**Concurrency.** A 2-minute lease (`syncLeaseUntil`) allows one sync per order; a second request gets `409 busy`. Every write is conditional on the account identity read at the start, so if the Riot ID changes mid-sync the sync stops and its writes roll back.

**PUUID recovery.** A 400 on a `by-puuid` call triggers one Riot ID lookup.
- If it returns a *different* PUUID, the new one is checked against the region, stored, and the work retried once.
- If it returns the same PUUID, or the lookup fails, the old PUUID is kept and the sync reports an error.
- Riot's docs don't say whether PUUIDs depend on the API key; this handles both cases.

**Rate limits.** Every request reserves a slot in the shared limiter (per key fingerprint and host) first. A 429 puts the host into a shared cooldown for Retry-After; waits over 5 seconds fail fast and are never retried in a loop. `POST …/riot/sync` also keeps its limit of 2 per minute per user and order.

**Diagnostics.** Errors carry a `kind`: `missing_key`, `unauthorized` (401), `forbidden` (403: invalid key, expired dev key or endpoint not permitted, which Riot doesn't distinguish), `rate_limited`, `not_found`, `bad_request`, `network`, `outage`, `invalid_response`. Server logs are JSON lines with `status`, `endpointFamily`, `host`, `orderId` and `correlationId`; they never include the key or headers. Users only see safe messages.

**Rank sources.** The current rank comes only from Riot (League-V4 observation); an observation older than 24 hours is flagged stale. Manual rank reporting was removed; legacy `reported*` columns on `orderRiotAccount` are no longer read. VALORANT and TFT orders show the ordered start/target from their own rank system and an honest "not tracked automatically" state.

### Order-specific match attribution

A match is stored for an order only if all of these hold: the order's account (PUUID) played it; it ran entirely inside a **work window** (assignment `startedAt` → `endedAt`/now, minus `ORDER_PAUSED`→`ORDER_RESUMED` gaps); its queue matches the service (Rank Boost → Solo/Duo 420); and it isn't a remake (`gameEndedInEarlySurrender` on any participant, or under 4 minutes long). Rows are unique on `(orderId, matchId)`. Champion icons are resolved from `championId` through Data Dragon `champion.json`; the name string is only a fallback.

The progress **baseline** is captured from Riot only if no order game has been played yet. Otherwise the customer's declared starting rank is used, with LP shown as unknown.

## API

| Method | Path | Who |
| --- | --- | --- |
| PATCH / DELETE | `/api/orders/{id}/game-account` | customer owner and admin, until locked; 409 when locked |
| POST | `/api/orders/{id}/riot/sync` | workspace participants. 200 synced, 409 busy or needs account, 422 wrong region or not found, 429 rate-limited (Retry-After), 503 integration off |
| GET | `/api/orders/{id}/matches?cursor=&limit=` | workspace participants |
| POST | `/api/orders/{id}/pause` | customer owner only (IN_PROGRESS with a booster) |
| POST | `/api/orders/{id}/resume` | customer owner only (PAUSED) |
| GET | `/api/orders/{id}/status` | workspace participants |
| POST | `/api/booster/orders/{id}/abandon` `{assignmentId, reason}` | assigned booster |
| GET | `/api/admin/orders` | admin (draft list) |
| PATCH | `/api/admin/orders/{id}` | admin (DRAFT only) |
| POST | `/api/admin/orders/{id}/republish` `{confirm:true}` | admin (DRAFT only) |

## Database

Migration `20261112200000_order_workspace_draft_riot_matches` (additive only):
adds `OrderStatus.DRAFT`, `order.completedAt`, `notification.dedupeKey` with a unique `(userId, dedupeKey)`, the `orderRiotAccount` and `orderMatch` tables, and RLS enabled on the two new tables (no policies). Prisma connects as the table owner, so it isn't affected.

Migration `20261112230000_riot_sync_integrity` (additive only) adds `orderRiotAccount.lastSyncErrorCode`, `regionVerifiedAt`, `matchScanUntil`, `pendingMatchIds TEXT[] DEFAULT '{}'` and `syncLeaseUntil`, plus the `riotApiThrottle` table with RLS enabled.

Apply to staging first: `npx prisma migrate deploy` (not run automatically).

## Manual verification

1. As a customer, open an order: add a Riot ID and region, and confirm the "pending integration" notice and the "From order" source on the ranks.
2. As an approved booster, claim the order from Available Orders, open it, and send chat messages both ways in two browsers (no refresh needed).
3. Customer → Pause order. The booster's workspace shows the PAUSED stop banner (live), Complete/Abandon are disabled, and the booster gets an "Order Paused - Stop Boosting" notification. Customer → Resume order; the booster is told they may continue.
4. Booster → Complete. Customer, booster and admin each get exactly one "Order Completed" notification linking to the order.
5. Claim another order → Abandon with a reason. The booster is redirected and loses access. The order is "Under review" for the customer, absent from Available Orders, and admins are notified.
6. Admin → `/dashboard/admin/orders` → Review → edit → Republish. The order reappears in Available Orders.
7. Try opening another customer's order ID as a customer or an unassigned booster. You should get a 404.
