# Boosting Platform: Audit Report and Build Spec (for Claude Code)

**Audit date:** 2026-11-12
**Reference sites:** lolboost.gg, gameboost.com, eloboost24.eu
**Scope:** booster system, customer system, game-tracking system (Riot focus). Game catalog and service creation are OUT of scope: seed them statically.

---

## 0. How to read this document

### 0.1 Evidence levels (important)
Every claim is tagged so you know how much to trust it.

| Tag | Meaning |
|---|---|
| **[VERIFIED]** | Read directly from the live site or official docs during this audit |
| **[REPORTED]** | From third-party reviews/articles about the site |
| **[INFERRED]** | Not observed. Standard industry practice or my design recommendation |
| **[DECISION]** | A choice you can change. Defaults are given |

### 0.2 Audit coverage limits
- **lolboost.gg**: fully readable. Landing page, LoL rank-boost order form, and booster recruitment/rules page were read. **Most of this spec's "verified" detail comes from here.**
- **gameboost.com** and **eloboost24.eu**: both blocked automated access (bot protection). Their internals (booster dashboard, payout rules) are **not verified**. Only third-party descriptions exist. Where this spec describes booster dashboards/payouts beyond LoLBoost, it is [INFERRED] or [REPORTED].
- The booster-side dashboard of every site is behind login and could not be audited. The booster workflow below is reconstructed from public recruitment pages plus industry patterns.
- **Action for you:** if you can screenshot the booster dashboards of the three sites, feed them to Claude Code and have it diff against section 5.

### 0.3 Legal and platform risk (read before building)
- Account boosting violates Riot's Terms of Service. Customers can get banned. LoLBoost's own FAQ admits this risk [VERIFIED]. Build clear risk disclosure and a refund/ban policy into checkout.
- Riot's developer policy (see section 7.4) restricts what you can display, requires player opt-in via RSO, and **a production key may be refused for a boosting product**. The architecture below isolates Riot data behind a provider interface so the platform still works with manual progress entry if API access is denied.
- Payments: card processors (Stripe/PayPal) often restrict or ban gaming-boost merchants. Plan a processor strategy and crypto fallback. [INFERRED]
- This spec does not cover evasion of Riot detection. It only covers marketplace, order, payout and stats-display functionality.

---

## 1. Product overview

A two-sided marketplace.

- **Customer** buys a service (rank boost, win boost, placements, duo, coaching...), pays into escrow, follows progress live, chats with the booster.
- **Booster** applies, is vetted, claims open orders, plays them, gets paid from escrow minus platform fee.
- **Admin/Support** manages vetting, disputes, fines, refunds, payouts.
- **Tracker** reads the customer's Riot account (rank, division, LP, match history) so progress is visible and partly verifiable without trusting the booster.

Core flow:

```
Customer configures order -> pays (escrow) -> order enters OPEN pool
-> Booster claims (lock) -> contacts customer / starts within SLA
-> Tracker polls Riot API, shows live rank/LP/matches
-> target reached -> COMPLETED -> customer confirms (or auto-confirm)
-> escrow released: booster payout + platform fee
```

---

## 2. Audit findings: LoLBoost (primary reference)

### 2.1 Site structure [VERIFIED]
- Multi-vertical marketplace: Boosting, Accounts, Items, Top-ups, Coaching, Digital Goods, "Companions". **Ignore all but Boosting + Coaching.**
- Public pages: `/boosters` (verified booster list), `/boosters/{id}` (public booster profile), `/reviews`, `/loyalty`, `/lootboxes`, `/blog`, `/jobs`, `/become-a-booster`, legal pages (terms, privacy, imprint, buyer-protection, DMCA).
- Languages: 20+. Currencies: EUR, USD.
- Auth: email+password, Google, Discord, **guest checkout** (enter email, order details and login are sent there), email verification code, forced password reset flow.
- Trust claims: "Shield" escrow messaging, 30+ payment methods, 24/7 live chat + Discord support, verified reviews (1,615 at audit time, 5.0 avg).

### 2.2 Boosting service types for LoL [VERIFIED]
Rank Boost, Win Boost, Placement Boost, Hire Pro Teammate (Pro Games), Duo Pass (hours-based), Ranked 5s, Normal Matches, Expert Coaching, Champion Mastery, Arena Boost, Level Boost, Clash Boost, Pay Per Games.
Game-specific boost types differ per game, but the **order form shape is the same**.

### 2.3 Customer order form (rank boost) [VERIFIED]
Fields and options:

| Field | Values |
|---|---|
| Current rank | Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master + division IV..I |
| Current LP bracket | 0-20, 21-40, 41-60, 61-80, 81-100 |
| Desired rank | same tiers/divisions |
| Desired LP | (shown) |
| LP gain per win | 30+, 25-29, 20-24, 10-19 (affects price: lower gain = pricier) |
| Server | EU-West, North America, Middle East, EU-Nordic & East, Brazil, Oceania, Russia, Turkey, LAN, LAS, Japan, Vietnam, Philippines, Singapore, Thailand, Taiwan |
| Queue | Ranked Solo/Duo, Ranked Flex |
| Boosters count | 1 to 4 (flex queue with duo) |
| Mode | **Solo** (booster plays on your account) or **Duo** (you play with the booster, no credential sharing) |

Extras with price modifiers shown at audit [VERIFIED]:

| Extra | Modifier |
|---|---|
| Priority boost | +25% |
| Bonus win | included automatically (+1 win) |
| Solo only | +20% |
| Stream games | +15% |
| Voice chat | +20% |
| Choose champions | +10% |
| Choose roles | free |
| Undercover winrate | +25% |
| Moderate KDA | +20% |
| Hidden duo | +50% |
| Offline mode / VPN | described in copy; treat as default-on |
| Preferred booster | pick from list, or "Any Available" |

Order summary shows: rank path, options, estimated completion time, promo code field, "use a reward coupon" selector, total, **cashback (2% as LB Coins)**, Buy Now.

Roles/champions selection is a secondary modal: pick roles (Top/Jungle/Mid/ADC/Support), pick champions.

### 2.4 Customer experience promises [VERIFIED]
- Boost starts typically 15-30 min after order.
- Order tracking and booster chat in the dashboard.
- Customer can request the same booster again at checkout.
- Solo: customer should not log in while booster plays. Duo: customer plays together with the booster.
- Refund: if not started, support can review; in-progress orders are reviewed individually.
- After completion: change password, enable 2FA.
- Payment is "held until the service is completed" (escrow wording); refunded if not deliverable.
- Support: live chat and Discord, include order number.

### 2.5 Reviews system [VERIFIED]
- Reviews are tied to a **verified order**, show: game, service type, rank range (e.g. "Gold III -> Platinum IV"), date, free text, **preset praise tags** (Very Skilled, Fast Delivery, Friendly Booster, Great Communication, Would Order Again, Consistent Performance, Tilt Proof, Followed Instructions, Clean & Discreet), reviewer initials, and a link to the booster.
- Aggregates: average score, total count, % five-star.

### 2.6 Loyalty and rewards [VERIFIED]
- Every order earns Reward Points (up to 8% back, more with tier).
- Points spent on tiered **lootboxes** (Starter, Silver, Gold, Diamond, Challenger; Challenger costs 600 points) giving wallet credit, discount coupons (5-15%), free priority.
- Free daily gift box.
- Wallet credit and coupons feed back into checkout.
- This is marketing. Implement last, after core flow works.

### 2.7 Booster recruitment and rules (LoLBoost) [VERIFIED]
Recruitment funnel:
1. **Apply**: games, peak ranks, account history, availability (~5 min form).
2. **Review and trial**: rank/history check; strong applicants invited to a short Discord trial.
3. **Claim orders**: pick from booster dashboard. "No forced assignments."
4. **Get paid**: balance grows per completed order; request payout to bank or crypto wallet "at any time".

Requirements: high peak rank in the applied game; clean history (no boosting/scripting bans); consistent win rate at that level; stable internet, capable PC.

Booster rules (these are the SLA rules to encode):
- Contact the customer **within 5 minutes** of locking an order.
- **Start a claimed order within 1 hour.**
- Reply to customers within 5 minutes.
- Tell customers about breaks in advance.
- Never share PayPal/Discord/contact info outside the website chat.
- Always play in Offline Mode; no in-game chat or summoner-spell swaps unless needed; no Blue Essence/RP spend without approval.
- No third-party software; report account issues to admins; use region-matched VPN.
- Follow every order specific the customer picked.
- **Never share or hand orders to other boosters.**
- Violations: **fines deducted from booster balance**; full fine list visible in dashboard. Serious cases (private boosting, third-party software) end cooperation.

Booster benefits (confirms feature set):
- Choose own orders, no shifts or minimum hours.
- **Public booster profile** built from reviews and completed orders; customers can request a booster by name.
- Private Discord with order alerts.
- Platform handles payments, support, disputes.

### 2.8 Public booster profile [VERIFIED + INFERRED]
Verified: `/boosters/{numeric id}` exists, linked from reviews; boosters have display names (e.g. "Ahmed", "Dckz"); the list page is titled "Verified pro players".
Inferred fields for a profile page: avatar, display name, games, peak rank per game, completed orders count, rating, tag counts from reviews, languages, recent reviews, availability badge.

---

## 3. Audit findings: GameBoost and EloBoost24 (limited)

Both sites blocked automated access. What is known:

**GameBoost** [REPORTED]
- Croatian company, marketplace-style (accounts, items, boosting, coaching), seller fee around 10% per a third-party review site.
- Terms reference ID verification that can pause orders until verified, one account per user, and discretionary withholding/refunds on misuse. [VERIFIED from its ToS snippet]
- Treat its seller/booster model as marketplace-style: sellers/boosters list or claim offers and are paid from escrow. [INFERRED]

**EloBoost24** [REPORTED]
- Long-running (7+ years), "hundreds of boosters".
- Customer order page reportedly includes: match history, boost progress, **spectate games on your account**, live chat with the booster, **pause order**, **tip your booster**. This is the best public description of the customer-side order page across the sector. Adopt it.
- Described as budget-oriented without a "premium workflow".

**Industry-typical order page (cross-site, REPORTED):** live status (waiting / in progress / complete), stage timeline, activity feed, direct booster chat, anonymous chat, schedule, secure credential transfer, notifications by sound and email, order protection and refund policy.

**Booster-side behaviors at comparable sites (REPORTED, for reference):**
- Application then manual review via Discord, payout method linked during onboarding.
- Fee model example: 10% platform fee on completed orders, buyer service fee separate, no additional holding period once eligible. Payout details and requirements published in a help center. Withdrawal methods vary. Minimum payout thresholds are common.
- Fast payouts (24h) are used as a recruiting selling point.

---

## 4. Product requirements

### 4.1 Roles and permissions

| Role | Capabilities |
|---|---|
| Guest | Browse, configure and check out as guest (email only) |
| Customer | Orders, chat, reviews, wallet, loyalty, linked Riot accounts |
| Booster | Applications, claim/abandon orders, chat, earnings, payouts, profile |
| Support | View/pause orders, reassign, refund, mediate chat, edit statuses |
| Admin | Everything + vetting, fines, payout approval, config (fees, SLAs, prices) |

A user may hold multiple roles (e.g. customer + booster). Use role flags, not separate accounts.

### 4.2 Scope boundaries
IN: auth, orders, escrow, payments, booster lifecycle, claiming, abandonment, chat, reviews, tracker, payouts, fines, disputes, notifications, admin.
OUT (static/seeded): game list, service definitions, price tables. Provide a `catalog.seed.json` and a price-calculation function reading it.

---

## 5. Booster system (detailed spec)

### 5.1 Booster lifecycle

```
APPLICANT -> UNDER_REVIEW -> TRIAL -> ACTIVE <-> SUSPENDED -> TERMINATED
                    \-> REJECTED
```

- **Application form** fields: display name wanted, contact (Discord handle), country, timezone, games, per-game peak rank + region + screenshot/proof, role/champion pool, languages, service types (solo/duo/coaching), availability, payout preference, rules acceptance, optional notes.
- **Review**: admin sees application, can request info, approve to TRIAL, reject with reason.
- **Trial**: limited access (low-value orders, or admin-supervised). [DECISION: a `trial_orders_remaining` counter]
- **ACTIVE**: full claim access per their approved games/rank ceilings.
- **SUSPENDED**: cannot claim; existing orders reassigned or completed by decision.
- **TERMINATED**: removed; outstanding balance handling per policy.

Gate claiming by `booster_game_permission` (game, max_tier_service, regions, service_types). A booster approved for Diamond cannot claim Master orders.

### 5.2 Booster profile
Private: legal name, KYC status, contact, payout methods, notes.
Public: display name, avatar, games, peak ranks, completed order count, rating, tag counts, languages, bio, recent reviews, online/available badge.
Stats (computed): completion rate, abandon rate, avg start delay, avg completion vs estimate, avg response time, review average, active order count.

### 5.3 Booster dashboard (screens)
1. **Available orders (the pool)**: filter by game, service, region, rank range, price; sort by newest/price/priority. Priority orders pinned. Each card shows: service, from -> to, server, queue, solo/duo, extras (offline, stream, hidden duo, etc.), **booster payout (never the customer price)**, estimated duration, "Claim".
2. **My orders**: active, paused, completed, abandoned.
3. **Order workspace**: customer requirements, credentials (revealed only after claim and lock), chat, tracker feed, status controls, progress note submission.
4. **Earnings**: available balance, pending (escrow not yet released), lifetime, per-order breakdown, fines with reasons, payout history.
5. **Payout request**: choose method (bank/crypto), amount, history, status.
6. **Rules and fines**: rules checklist, fine schedule, violations history.
7. **Profile editor** and **notifications**.

### 5.4 Order claiming

Rules (derived from LoLBoost rules [VERIFIED] + concurrency requirements [INFERRED]):

1. Only `OPEN` orders matching the booster's permissions are claimable.
2. Claim is **atomic**: one booster wins. Implement with a conditional update:
   `UPDATE orders SET status='CLAIMED', booster_id=$b, claimed_at=now() WHERE id=$o AND status='OPEN'` and check affected rows = 1.
3. Max concurrent active orders per booster (config, default 3). [DECISION]
4. Preferred-booster orders: visible/claimable only by that booster for N minutes (config, default 30), then fall back to the pool. [DECISION]
5. On claim, a **SLA timer** starts:
   - `contact_deadline = claimed_at + 5 min` (must send first chat message)
   - `start_deadline = claimed_at + 60 min` (must set status IN_PROGRESS, or tracker must show a new ranked game)
6. SLA miss -> warning notification, then **auto-release** to the pool, record a strike on the booster (see 5.6).
7. Credentials/customer account details are decrypted and shown **only to the assigned booster**, only while the order is CLAIMED/IN_PROGRESS/PAUSED. Log every reveal.
8. Boosters can never transfer an order to another booster directly [VERIFIED rule]. Only support can reassign.

### 5.5 Order abandonment

Two paths:

**A. Voluntary release by booster**
- Allowed before `IN_PROGRESS` with no penalty if within a short grace window (default 10 min after claim). [DECISION]
- After that: requires a reason; counts as an abandon strike; order returns to `OPEN` with `priority=true` flag (platform may absorb the bump).
- If progress has been made, record progress and pay **pro-rata** to the booster (see 5.7) and re-price the remaining work for the next booster.

**B. Forced release by system**
- SLA miss (5.4), inactivity (no tracker-detected games and no chat for X hours while IN_PROGRESS and not PAUSED, default 12h), booster suspended.
- Same state change as A, with system reason code.

**On any release:**
1. Snapshot current rank/LP from tracker as the new `start_state` for the remainder.
2. Set `booster_id=NULL`, status `OPEN`.
3. Notify customer ("we are assigning a new booster") and booster.
4. Revoke the old booster's credential access immediately and flag "customer should rotate password" if the old booster had access. [INFERRED best practice]
5. Add abandon strike; thresholds trigger fines/suspension (5.6).

### 5.6 Fines, strikes, suspensions
- `booster_fines` table: reason code, amount, order, issued_by (system/admin), appealed flag.
- Fines deducted from the booster's available balance via a **ledger entry**, never by mutating a number. [LoLBoost: fines are deducted from balance, VERIFIED]
- Full fine schedule must be visible to boosters [VERIFIED]. Seed a schedule, e.g.:

| Code | Trigger | Default action |
|---|---|---|
| SLA_CONTACT | no contact in 5 min | warning, then small fine |
| SLA_START | not started in 60 min | auto-release + strike |
| ABANDON | release after work started | strike + fine proportional to order |
| CONTACT_LEAK | shared external contact | fine |
| NO_OFFLINE_MODE | offline mode rule broken | fine |
| UNAUTHORIZED_SPEND | spent currency without approval | fine + review |
| THIRD_PARTY_SW | scripts/bots | termination |
| PRIVATE_BOOSTING | working outside platform | termination |

Amounts are placeholders. [DECISION]
- Strike thresholds: e.g. 3 strikes in 30 days -> auto-SUSPEND pending admin review.

### 5.7 Booster earnings and payment

Money model:
- `customer_price` (what the customer paid) -> `platform_fee` + `booster_payout`.
- `booster_payout = base_payout_for_service(from, to, region, extras)`. Store it **on the order at creation** so later pricing changes do not alter it.
- Reference points: a comparable marketplace documents a **10% booster fee** with the buyer service fee kept separate [REPORTED]. LoLBoost's split is not public. [DECISION: default platform fee 20-30% for managed boosting, configurable per service]

Earning states:
1. `PENDING` : order claimed/in progress, escrow held.
2. `AVAILABLE` : order completed and (customer confirmed OR auto-confirm after N hours, default 24h) and no open dispute.
3. `PAID_OUT` : included in a payout.
4. `CLAWED_BACK` : refund/dispute/ban resolution.

**Pro-rata on partial completion:** payout = payout_total x (progress_made / progress_total), where progress is measured from tracker (divisions/LP or wins/games). [DECISION]

**Payout flow:**
1. Booster adds payout method (bank / crypto wallet / PayPal), verified; changing it triggers a cooldown (e.g. 48h) and email confirmation. [INFERRED]
2. Booster requests payout <= available balance, >= minimum threshold (config, default 20 EUR).
3. Status `REQUESTED -> APPROVED -> PROCESSING -> PAID | FAILED | REJECTED`.
4. Admin approves (or auto-approve under a trust threshold). On PAID write ledger entry and store transaction reference.
5. Failed payout returns funds to AVAILABLE.
6. Optional "Idempotency-Key" on payout requests to prevent double submit.

KYC: gate first payout above a threshold on identity verification. [INFERRED; matches GameBoost ID-check language VERIFIED in ToS]

### 5.8 Booster-customer communication
- All contact through in-platform chat (booster rule: no external contact [VERIFIED]).
- Chat can be **anonymous** (booster display name only) [REPORTED at competitors].
- Auto-moderation: block/flag patterns for emails, phone numbers, Discord handles, PayPal strings. Flag to support, don't silently store on the booster's side.
- Support can join any order chat.
- Notifications: in-app, email, optional sound. Events: order claimed, started, paused, progress milestone, completed, message received, SLA warning.

---

## 6. Customer system (detailed spec)

### 6.1 Account and auth
- Email/password, Google OAuth, Discord OAuth, guest checkout with magic-link order access. [VERIFIED]
- Email verification code; forced password reset support. [VERIFIED]
- Optional 2FA for customers and **mandatory** for boosters and staff. [DECISION]
- Currency (EUR/USD) and language preferences. i18n scaffolding from day one (start with EN + FR).

### 6.2 Order configuration and pricing
Price function (put in a pure, unit-tested module):

```
base = sum over each division step from current -> desired of step_price[tier][division][region_multiplier]
lp_adjustment = f(current_lp_bracket, lp_gain_bracket)
extras_multiplier = product or sum of extra modifiers (document which; LoLBoost style is additive percentages) [DECISION: additive]
subtotal = (base + lp_adjustment) * (1 + sum(extra_pcts))
discount = coupon + wallet/loyalty (ordered, capped)
total = subtotal - discount
booster_payout = total_before_discount * (1 - platform_fee)   # computed at order creation
```

Seed price tables in `catalog.seed.json`. Show estimated completion time: `sum(step_hours)` adjusted by extras (priority shortens, stream/hidden-duo lengthen). [INFERRED]

Validation: desired > current, same region/queue, not above supported ceiling (LoLBoost caps at Master in the form [VERIFIED]), booster count 1-4 only for Flex, duo vs solo rules.

### 6.3 Checkout and payment
- Provider abstraction: `PaymentProvider` interface (Stripe, PayPal, crypto gateway). [LoLBoost shows Stripe, Visa, Klarna, PayPal, crypto VERIFIED]
- Create order as `PENDING_PAYMENT` -> redirect/confirm -> **webhook** confirms -> status `PAID` -> `OPEN`.
- Webhooks must be idempotent and signature-verified. Never trust the browser redirect.
- Funds are held conceptually as escrow: tracked via ledger (section 8.3), not by a processor feature.
- Coupons, wallet credit, loyalty cashback (LoLBoost: 2% as coins [VERIFIED]).
- Risk disclosure checkbox (ban risk) before paying. [DECISION, recommended]

### 6.4 Customer order page (the key screen)
Combine LoLBoost + EloBoost24 + industry features:
1. **Header**: order id, service, from -> to, server, status badge, ETA.
2. **Progress**: stage timeline (placed / claimed / started / in progress / completed) and a **live rank card**: current tier, division, LP, W/L from the tracker, with progress bar toward target.
3. **Match history**: games played since order start, with champion, KDA, result, LP delta, duration, link. Mark which games were played by the booster vs customer.
4. **Activity feed**: system + booster notes ("Session 1 reached Diamond II") [REPORTED pattern].
5. **Chat** with booster (and support).
6. **Controls**: Pause / Resume (customer wants to play), request change, cancel (rules by state), **tip booster** [REPORTED], spectate link if supported, "report a problem".
7. **Credentials panel**: submit/update account details securely (encrypted), 2FA/recovery guidance, "change password after completion" reminder [VERIFIED].
8. **Completion**: confirm completion -> review form (rating, tags, text) -> reorder with same booster [VERIFIED feature].
9. **Duo mode variant**: no credentials panel; instead shows scheduling, booster's Riot ID to add, session times.

### 6.5 Customer cancellation and refunds
LoLBoost wording [VERIFIED]: unstarted orders can be refunded on request; in-progress orders reviewed individually. Implement:

| State | Refund |
|---|---|
| PENDING_PAYMENT | cancel freely |
| OPEN (unclaimed) | full refund, self-serve |
| CLAIMED (not started) | full refund, notify booster |
| IN_PROGRESS | partial refund by progress, support-reviewed |
| COMPLETED | none, except dispute |
| Ban on account | policy-defined; log evidence. Competitors often decline or offer partial credit [REPORTED] |

Refunds create ledger entries and may claw back booster earnings.

### 6.6 Disputes
- Customer or booster opens dispute with reason + evidence (screenshots, chat log, tracker snapshots). Order enters `DISPUTED`, payouts frozen.
- Support resolves: full refund / partial / release to booster / re-assign. Every action is audit-logged.

### 6.7 Reviews
- Only for COMPLETED orders by the buying customer (one per order).
- Fields: 1-5 stars, free text, preset praise tags (list in 2.5), optional private feedback to support.
- Affects booster rating and public profile; admins can hide abusive reviews.

### 6.8 Loyalty (phase 4)
Points per EUR, tiers, wallet credit, coupons, lootboxes. Keep in a separate module with its own ledger. Skip initially.

---

## 7. Game tracking system (Riot-focused)

### 7.1 Purpose
Give both sides a **trusted, automatic view of progress**: current rank, division, LP, and match history since order start. Also enables auto-detecting "booster started" (SLA), completion (target reached), abandonment (inactivity), and anomalies.

### 7.2 Identity: Riot ID -> PUUID
- Customer provides **Riot ID** (`gameName#tagLine`) + region at order time.
- Resolve to **PUUID** with Account-V1 and store `puuid` as the canonical key (names change, PUUID doesn't). Re-resolve Riot ID periodically for display.
- Riot's policy: show Riot IDs, not summoner names, in third-party UIs. [VERIFIED]

### 7.3 Endpoints to use (LoL) [VERIFIED unless noted]

Routing: there are two host families.
- **Regional** (`americas`, `europe`, `asia`, `sea`): Account-V1, **Match-V5**.
- **Platform** (`na1`, `euw1`, `eun1`, `kr`, `jp1`, `br1`, `la1`, `la2`, `oc1`, `tr1`, `ru`, `ph2`, `sg2`, `th2`, `tw2`, `vn2`): Summoner-V4, League-V4, Spectator-V5, Champion-Mastery-V4.
Maintain a `platform -> regional` map (e.g. euw1/eun1/tr1/ru -> europe; na1/br1/la1/la2 -> americas; kr/jp1 -> asia; oc1/ph2/sg2/th2/tw2/vn2 -> sea).

| Need | Endpoint |
|---|---|
| Riot ID -> PUUID | `GET {regional}/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` |
| PUUID -> Riot ID | `GET {regional}/riot/account/v1/accounts/by-puuid/{puuid}` |
| Profile icon, level | `GET {platform}/lol/summoner/v4/summoners/by-puuid/{puuid}` |
| **Rank, division, LP, W/L** | `GET {platform}/lol/league/v4/entries/by-puuid/{puuid}` (current approach; the older `by-summoner/{id}` route is being phased out, so prefer by-puuid) |
| Match id list | `GET {regional}/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=20` (supports `startTime`, `endTime`, `type`) |
| Match detail | `GET {regional}/lol/match/v5/matches/{matchId}` |
| Match timeline | `GET {regional}/lol/match/v5/matches/{matchId}/timeline` |
| Live game | `GET {platform}/lol/spectator/v5/active-games/by-summoner/{puuid}` |
| Mastery | `GET {platform}/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}` |
| Static assets | Data Dragon (champion/item/profile icon images, version list) |

League-V4 entry fields to store: `queueType` (`RANKED_SOLO_5x5`, `RANKED_FLEX_SR`), `tier`, `rank` (division I-IV), `leaguePoints`, `wins`, `losses`, `hotStreak`, `veteran`, `inactive`. Apex tiers (Master+) have no divisions, only LP.
Queue ids [INFERRED from common knowledge, verify against Riot's queue list]: 420 = ranked solo/duo, 440 = ranked flex.

Auth header: `X-Riot-Token: <key>` from server only. Never ship the key to the browser. [VERIFIED policy]

### 7.4 Riot policy constraints that shape the design [VERIFIED]
- **Production key** needed for serious use; **RSO (Riot Sign On)** is available only with a production key.
- Policy says player data should only be shown to others when the player **opted in** (RSO). Showing a player's own stats to themselves is an approved use; scouting others is not.
- Products cannot create alternatives to official ranking (e.g. MMR/ELO calculators) [VERIFIED]. **Do not compute or display an invented MMR.** Display only official tier/division/LP.
- Product must be registered in the developer portal; no data-broker use; no Riot-IP lookalikes; must carry the "not endorsed by Riot Games" disclaimer.
- **Dev key limits:** 20 requests/sec and 100 requests/2 min [VERIFIED via reference]. Production limits are higher after approval.
- Riot may reject a boosting use case. **Design for this**: see 7.7.

### 7.5 Valorant [VERIFIED limits]
- Official Valorant API: content, status, `val-match-v1` (match/matchlist by PUUID), `val-ranked-v1` **leaderboards only**. There is **no public endpoint for an individual player's current rank/RR**. All Valorant apps must use RSO opt-in. Treat Valorant tracking as **manual/booster-reported** unless you later get production access and an approved data source.
- TFT has its own match/league endpoints (tft-match-v1, tft-league-v1) via the same routing. Same pattern as LoL; add after LoL works.

### 7.6 Tracker architecture

```
Order (puuid, platform, queue, start_snapshot, target)
        |
   Scheduler/Workers  (BullMQ / pg-boss / cron)
        |
  RiotProvider  --- rate limiter (token bucket per key, per platform host) ---> Riot API
        |
  rank_snapshots + tracked_matches (+ cache)
        |
  Order progress service -> websocket/SSE to customer & booster UIs
```

Polling strategy [DECISION]:
- Active orders (status IN_PROGRESS): rank poll every 60-120 s; match-id poll every 60-120 s.
- Claimed, not started: poll every 2-3 min to detect first game (SLA).
- Paused/idle: every 15 min.
- When a new match id appears: fetch match detail once, cache forever (matches are immutable). Take a rank snapshot right after to compute the LP delta.
- Use `startTime` = order start so you only list relevant games.
- Backoff on 429 honoring `Retry-After`; centralize rate limiting. Dedupe calls across orders.

**LP delta caveat:** Match-V5 does not report LP gained/lost. Compute `lp_delta` by diffing consecutive `rank_snapshots` around the game (snapshot before and after). Promotions/demotions: LP resets, so store tier+division+LP and compute progress as a **linear points scale** (e.g. `tier_index*400 + division_index*100 + LP`) **internally for the progress bar only**. Do not display it as MMR. For Master+, use LP directly.

Progress calculation: `progress% = (current_points - start_points) / (target_points - start_points)`, clamped to 0-100. Mark order `TARGET_REACHED` when `current >= target` (and apply "bonus win" extra by requiring +1 win if purchased). Final completion still needs booster submit + customer confirm or auto-confirm.

Per-match display fields: championId/name, role (teamPosition), kills/deaths/assists, CS, win/loss, duration, queueId, gameEndTimestamp, items, and the computed `lp_delta`. Also track `played_by`: attribute the game to booster vs customer by session windows (booster marks sessions; games inside a session window default to booster). [INFERRED]

Anomaly flags for support (cheap, high value): game played during PAUSED; ranked game when no booster session open; large winrate drop; many games against SLA "LP gain" bracket; account inactive. Surface as alerts, don't auto-punish.

### 7.7 Provider abstraction and fallback (critical)
```ts
interface RankProvider {
  resolveAccount(riotId, platform): Promise<{puuid, gameName, tagLine}>
  getRank(puuid, platform, queue): Promise<RankSnapshot>
  getMatchIds(puuid, platform, opts): Promise<string[]>
  getMatch(matchId, platform): Promise<MatchSummary>
}
```
Implementations: `RiotApiProvider` (official), `ManualProvider` (booster submits rank screenshots/values; support verifies), `MockProvider` (dev/tests, seeded data). Order logic depends only on the interface. If Riot refuses a production key, switch config to `ManualProvider` + optional customer-side opt-in. Valorant starts as `ManualProvider` only.

### 7.8 Data minimization
Store only what is needed: puuid, platform, rank snapshots, match summaries (not full raw JSON beyond what you display, or keep raw in cold storage with TTL). Delete tracked data on a retention schedule after order completion (default 90 days). [DECISION; GDPR-friendly]

---

## 8. Technical design

### 8.1 Recommended stack [DECISION, replace freely]
- **Next.js (App Router) + TypeScript** frontend and API routes, or NestJS API + Next.js frontend if you prefer separation.
- **PostgreSQL** (Prisma or Drizzle) as the single source of truth.
- **Redis** for cache, rate limiting, job queue (BullMQ).
- **WebSocket/SSE** for live order updates and chat (or Pusher/Ably to start).
- Auth.js/Lucia for auth; `argon2` for passwords; TOTP 2FA.
- S3-compatible storage for application proofs and dispute evidence.
- Email: Resend/Postmark. i18n: next-intl.
- Observability: structured logs, Sentry, an `audit_log` table.

### 8.2 Order state machine

```
PENDING_PAYMENT -> PAID/OPEN -> CLAIMED -> IN_PROGRESS <-> PAUSED
                                   |            |
                                   |            +-> TARGET_REACHED -> COMPLETED -> CONFIRMED
                                   +-> (release/SLA) -> OPEN
OPEN|CLAIMED|IN_PROGRESS -> CANCELLED -> REFUNDED
ANY active -> DISPUTED -> (resolved) -> COMPLETED | REFUNDED | OPEN
```

Rules: transitions go through one `transitionOrder(orderId, event, actor)` function that validates allowed transitions, writes `order_events`, and emits notifications. No direct status writes elsewhere. Unit-test the transition table.

### 8.3 Money: ledger, not balances
Double-entry-style `ledger_entries(id, account, order_id, amount_minor, currency, type, created_at, ref)`.
Accounts: `customer_payment`, `escrow`, `platform_revenue`, `booster_pending`, `booster_available`, `booster_payout`, `refunds`, `fines`.
All money as **integer minor units** (cents) + currency. Booster "balance" = sum of ledger entries. Every state change that moves money = one DB transaction creating balanced entries. This makes fines, clawbacks, pro-rata and refunds auditable.

### 8.4 Schema (core tables)

```
users(id, email, password_hash, roles[], locale, currency, 2fa_secret, created_at)
oauth_accounts(user_id, provider, provider_id)
guest_sessions(email, magic_token, order_id)

riot_accounts(id, user_id?, order_id?, game, riot_id, puuid, platform, region_group, verified_via_rso bool)

catalog_games(id, slug) / catalog_services(id, game_id, slug, kind) / price_tables(...)   -- seeded

orders(id, public_ref, customer_id|guest_email, game, service_id, status, platform,
       queue, mode(solo|duo), start_tier, start_div, start_lp, target_tier, target_div,
       extras_json, lp_gain_bracket, price_total, currency, platform_fee, booster_payout,
       preferred_booster_id, booster_id, claimed_at, contact_deadline, start_deadline,
       started_at, completed_at, priority bool, created_at)
order_credentials(order_id, ciphertext, nonce, key_id, updated_at)    -- encrypted; see 8.5
order_events(id, order_id, type, actor_id, payload, created_at)
order_sessions(id, order_id, booster_id, started_at, ended_at, notes)

rank_snapshots(id, order_id, puuid, queue, tier, division, lp, wins, losses, taken_at)
tracked_matches(match_id PK, order_id, puuid, queue, champion, role, kda, win, duration,
                ended_at, lp_delta, played_by, raw_ref)

chat_threads(order_id) / chat_messages(id, thread_id, sender_id, body, flags, created_at)

boosters(user_id PK, status, display_name, bio, avatar, languages[], payout_pref, kyc_status,
         strikes, created_at)
booster_applications(id, user_id, answers_json, proofs[], status, reviewer_id, notes)
booster_permissions(booster_id, game, max_tier, regions[], service_kinds[])
booster_payout_methods(id, booster_id, type, details_encrypted, verified_at, locked_until)
booster_fines(id, booster_id, order_id?, code, amount_minor, issued_by, appeal_status)

ledger_entries(...)            -- 8.3
payouts(id, booster_id, amount_minor, method_id, status, tx_ref, requested_at, processed_at)

payments(id, order_id, provider, provider_ref, status, amount_minor, webhook_events[])
refunds(id, order_id, amount_minor, reason, status)
disputes(id, order_id, opened_by, reason, evidence[], status, resolution, resolved_by)
reviews(id, order_id UNIQUE, customer_id, booster_id, rating, tags[], body, hidden)
coupons(...), loyalty_ledger(...), notifications(...), audit_log(...)
```

### 8.5 Security requirements
- **Customer game credentials are the most sensitive data.** Encrypt at rest with envelope encryption (KMS key), decrypt only in a server action invoked by the assigned booster, log every reveal in `audit_log`, auto-delete after order completion + short grace period.
- Prefer **Duo mode** and never require credentials when avoidable.
- Rate-limit login, chat, claim, payout endpoints. CSRF protection, strict CORS, CSP.
- Payout-method changes: email confirm + cooldown.
- Role checks server-side on every endpoint; booster can only see their orders; customers only theirs; guests via signed magic link.
- Never expose booster payout to customers or customer price to boosters unless intended.
- Webhook signature verification and idempotency keys on payments and payouts.
- GDPR: export/delete account, data retention jobs, cookie consent (EU).

### 8.6 API surface (REST sketch)

```
POST /api/auth/*                      register/login/oauth/guest
GET  /api/catalog/*                   static catalog + price quote
POST /api/orders/quote                -> price, ETA, payout (customer sees price only)
POST /api/orders                      create PENDING_PAYMENT
POST /api/payments/webhook/:provider  -> PAID/OPEN
GET  /api/orders/:id                  order + progress + rank card
GET  /api/orders/:id/matches
POST /api/orders/:id/pause | resume | cancel | confirm | tip | dispute
PUT  /api/orders/:id/credentials
GET/POST /api/orders/:id/chat         (+ SSE/WS stream)
POST /api/orders/:id/review

GET  /api/booster/orders/available
POST /api/booster/orders/:id/claim
POST /api/booster/orders/:id/release  {reason}
POST /api/booster/orders/:id/start | session/start | session/end | note | complete
GET  /api/booster/earnings
POST /api/booster/payout-methods | payouts
GET  /api/booster/rules-and-fines
POST /api/booster/applications

GET/PATCH /api/admin/applications | boosters | orders | disputes | fines | payouts | refunds | config
GET  /api/boosters  and  /api/boosters/:id     public profiles
```

### 8.7 Background jobs
- `riot.pollActiveOrders` (rate-limited)
- `order.slaWatcher` (contact/start deadlines, inactivity, auto-release)
- `order.autoConfirm` (release earnings after N hours)
- `payout.processor`, `payment.reconcile`
- `retention.purge` (credentials, tracked data)
- `notification.dispatcher`

### 8.8 Admin panel (must-have screens)
Applications queue, booster list/status/permissions, live orders board with SLA colors, order detail with full event log and chat, dispute center, refund tool, fine tool, payout approvals, config (fees, SLA minutes, thresholds, price tables), audit log viewer.

---

## 9. Implementation plan for Claude Code

Build in vertical slices. After each phase the app must run and have tests.

**Phase 0 - Foundation**
Repo, TypeScript, Postgres + migrations, auth (email, Google, Discord, guest), roles, i18n scaffolding, `catalog.seed.json` (LoL only, Solo/Duo rank boost), price module + unit tests.

**Phase 1 - Customer ordering**
Order form (all fields in 2.3), quote API, order creation, `PaymentProvider` interface with a **fake/test provider** first, webhook flow, order list + basic order page, ledger entries on payment.

**Phase 2 - Booster core**
Application form + admin review, booster profile, available-orders pool, **atomic claim**, SLA timers + auto-release, order workspace, chat, session start/end, completion.

**Phase 3 - Tracker (LoL)**
`RankProvider` interface, `MockProvider` + `RiotApiProvider`, Account-V1 + League-V4 + Match-V5 integration, rate limiter, rank_snapshots, tracked matches, LP deltas, progress bar, live updates, auto-detect start/target.

**Phase 4 - Money completion**
Earnings states, auto-confirm, payout methods + requests + admin approval, fines, pro-rata release on abandon, refunds, disputes.

**Phase 5 - Trust and growth**
Reviews + public booster pages, loyalty/coupons/wallet, tips, notifications polish, anomaly alerts, real payment providers, KYC.

**Phase 6 - Extensions**
TFT via the same tracker, Valorant via ManualProvider, coaching service type, more games.

### Acceptance tests (minimum)
1. Two boosters claim the same order concurrently -> exactly one succeeds.
2. Claimed order with no contact in 5 min -> warning; no start in 60 min -> auto-release, strike recorded, credentials revoked.
3. Webhook replay does not double-credit or double-open an order.
4. Customer never sees payout fields; booster never sees customer price or credentials before claim.
5. Pro-rata payout on abandon equals expected value for a table of progress cases.
6. Ledger always balances; booster balance = sum of entries; fines reduce it.
7. Tracker: given a mock sequence of snapshots, progress%, LP deltas, promotion/demotion and target-reached are correct, including Master+ (no divisions).
8. Rate limiter never exceeds configured Riot limits across many orders; 429 triggers backoff.
9. State machine rejects illegal transitions.
10. Credentials are stored encrypted, reveal events are logged, and are purged after retention.

---

## 10. Open decisions for you
1. Platform fee per service (default 20-30%).
2. Escrow auto-confirm window (default 24h).
3. Fine amounts and strike thresholds.
4. Payment processor strategy given gaming-boost restrictions.
5. Whether to attempt a Riot production key now or start on `ManualProvider`.
6. Whether Solo (credential sharing) is offered at launch or Duo only (much lower security burden).
7. Customer-facing risk disclosure wording and your ban policy.
8. Hosting region and data residency (EU customers).

---

## 11. Sources consulted
- lolboost.gg: landing page, `/league-of-legends/rank-boost`, `/become-a-booster` (read directly).
- Riot Developer Portal policy pages (League, Valorant, API policy), Riot dev relations posts, SDK/reference documentation for Account-V1, Summoner-V4, League-V4, Match-V5, Spectator-V5, regional/platform routing, rate limits.
- Third-party reviews and articles describing EloBoost24, GameBoost, and competitor order pages; a marketplace help-center page describing a 10% booster fee model; competitor refund-policy pages.
- gameboost.com and eloboost24.eu were not directly accessible. Treat their sections as lower confidence.
