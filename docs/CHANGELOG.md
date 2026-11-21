# Changelog

Build-plan work log (see `docs/BUILD_PLAN_PHASES.md`). Newest first.

## 2026-11-21 · Customer dashboard: header buttons, poke, booster change, chat sound

Client PDF "Customer dashboard changes". Decisions: Change Booster is reviewed by an admin; Tip stays for completed orders; Poke at most once per hour; the four buttons are always shown, greyed out with a hint when they do not apply.

- **Order header (customer):** Tip, Pause order / Resume order, Change booster, Poke booster side by side. "Request cancellation" removed from the header (the request flow and admin page still exist).
- **Change booster:** the customer gives a reason; admins decide on the new **Booster Changes** page. Approve releases the booster and puts the order back on the marketplace (the replaced booster can never take it again); reject keeps the booster and shows the note to the customer. One open request per order. Table `orderBoosterChangeRequest` (migration `20261121120000_booster_change_and_poke`, applied).
- **Poke booster:** emails the booster "Your customer needs your attention on order #…" with an "Open order chat" button (`/dashboard/<order>?view=chat`). At most once per hour per order (`order.boosterPokedAt`, conditional update); the button shows when it can be used again.
- **Chat sound:** the customer hears a short ding when the booster writes, also while the chat is open (after the first click on the page, a browser rule).
- **Sidebar (customer):** Support and Become a Booster links removed.
- **Account tab first:** the first time a customer opens an order, the details card opens on Account (remembered per browser).

## 2026-11-20 · League order pages, step 3: Arena, Champion Mastery, win sliders

- **Champion Mastery:** champion card with the chosen champion's portrait, a search box and every champion in a scrollable grid; Server under it. "Mastery Level" box with Current and Desired Mastery (Level 1–10); the desired level must be higher. Order summary: "Jinx → Level 4 → Level 6". Solo only, extras Priority +25%, Stream Games +15%, Appear Offline free. Priced per level gained (`range:currentLevel:targetLevel`, $6 per level by default).
- **Arena:** Arena ranks (Wood, Bronze, Silver, Gold, Gladiator) with the client's icons (`public/images/ranks/arena/*.webp`), Server, Win Amounts 1–3 with a slider; Solo/Duo extras from the PDF (Duo: Your Champions and Roles +10%, Hidden Duo +25%). Default price $10 per win.
- **Net Wins and Placements:** 1–5 games, chosen with a slider (progress bar and clickable numbers).
- **Prices:** `scripts/apply-extras-prices.ts` also covers Arena and Champion Mastery (Mastery switches from a fixed price to a price per level).
- Order summary says "1 win" instead of "1 wins".

## 2026-11-19 · League order pages, step 1: extras, Duo +50%, new order summary

Client PDFs (Rank Boost, Net Wins, Placements, Arena, Champion Mastery, Normal Games). Decisions: Terms checkbox removed completely; under the extras only discount, total and Buy; short page addresses; Duo +50% on all games; Arena placeholder icons; FAQ text from the client; Champion & Role priced as in the tables; extras the app cannot check are shown to the booster as rules.

- **Extras catalog** (\`EXTRAS\` in \`lib/config/checkout-options.ts\`): Solo Queue Only +30%, +1 Bonus Win +7.5%, Priority Order +25%, Live Streaming +20%, Specific Champion and Role / VPN / Appear Offline free, Undercover Winrate +25%, Moderate KDA +25%, OTP Champ Only +35%, Voice Chat +20%, Hidden Duo +50%; each with hover text (Duo variant where the PDF differs), a booster rule and an icon. Rank Boost: 10 Solo / 6 Duo; Net Wins and Placements: 8 Solo / 4 Duo, in the PDF order per mode. Placements can now be bought in Duo.
- **Duo +50%** (was +40%) on every game. Extras and Duo are both calculated on the service price.
- **Fields:** Server (all regions, default EUW) on Rank Boost, Net Wins and Placements; Queue Type on Rank Boost and Placements; LP Gain on Net Wins; LP on Placements; Net Wins limited to 1–3 wins. The chosen server becomes the order's region (order page, OP.GG link, Riot ID box).
- **OTP Champ Only:** single-champion picker; the server requires a real champion when it is selected.
- **Order summary:** rank → target headline, Solo/Duo buttons without price badge, extras with icon, info tooltip, price from the server (\`optionAmounts\` in the quote, shown before switching on) and switch, "Handled by: Anyone available / Change", total, "Have a discount code?", Buy now. Removed: price breakdown, estimate, Terms checkbox (the server no longer requires it; recorded only if sent).
- **Order page:** "Booster rules" lists what each bought extra requires (e.g. VPN, KDA, OTP champion).
- **Short addresses:** /league-of-legends-rank-boost, /lol-boosting, /lol-placement-boost, /lol-arena-boost, /champion-mastery, /normal-games.
- **Prices:** \`scripts/apply-extras-prices.ts\` writes the next price version for each service (extras re-priced on the three redesigned pages, Duo +50% everywhere), keeping the admin's base / division / unit prices.
- Still to do: page layouts (step 2), Arena, Champion Mastery and Normal Games (steps 3–4), FAQ blocks.

## 2026-11-17 · Fix: completing with screenshots; booster balance cards

- **Fix:** "Complete" with screenshots failed with `violates check constraint "orderBoosterAssignment_active_order_check"`. That database rule (written before the `SUBMITTED` assignment status) only let active statuses keep the order link. Migration `20261120120000_assignment_submitted_check` (applied) adds `SUBMITTED` to it; no data change. The rule was missing from the test database snapshot, so tests did not catch it; the migration now adds it there too.
- **Booster dashboard home:** three money cards: **Balance** (can be cashed out now, links to Cash out), **Frozen balance** (held while a customer dispute is open), **Pending approval** (completed orders waiting for an admin release, plus how many orders are waiting for the customer's confirmation). Per currency, net of reversals (`boosterBalances` in `lib/finance/queries.ts`).

## 2026-11-17 · Rank updates limited to the bought range

- **Update rank** only offers the ranks of the order: from the starting rank to the target rank, both included (Bronze I → Gold I: Bronze I, Silver IV–I, Gold IV–I). The server refuses anything outside the range ("Choose a rank between … and …"), so the limit cannot be bypassed.
- Services without a start and a target rank (Win Boost, placements, normal games…) no longer show **Update rank**; they use chat and the completion screenshots.
- The picker opens on the latest update (or the starting rank) and states the allowed range.

## 2026-11-17 · Booster rank updates replace Riot tracking

No Riot API key is available, so the order page no longer uses Riot. Decisions: Riot removed from the page (code kept, unused); the booster reports the rank only; asked after every play session + reminder after 24 h; customer gets an OP.GG / tracker.gg link.

- **Removed from `/dashboard/[orderId]`:** Riot rank sync, the every-minute Riot check, match history, stat tiles, the Riot profile box and the "Sync Riot data" button. The Riot code (client, sync, routes) stays in the project unused, ready if a production key is ever approved.
- **Rank updates:** the working booster posts the current rank (tier, division, optional LP / RR) with **Update rank**; ending a play session opens the same form. The hero shows start → current (latest update, "Booster update · 2 h ago") → target with a % computed from the rank ladder (each division one step, LP / RR as a fraction). A **Rank updates** timeline replaces the match history. The customer gets a notification for each update ("now Gold III 42 LP").
- **Reminder:** no update for 24 h on an in-progress order → `PROGRESS_UPDATE_DUE` notification to the booster (one per 24 h, in the `sla-warnings` job); the page shows "No update for 24h".
- **Self-check link:** "Check on OP.GG" (League, TFT) or "Check on tracker.gg" (VALORANT) built from the customer's Riot ID and region; just a link, no data fetched. The Riot ID box keeps name#tag + region (no sync, no Riot status).
- New `POST /api/orders/[orderId]/progress` (working booster only). Migration `20261119120000_progress_updates` (table `orderProgressUpdate` with RLS, enum value `PROGRESS_UPDATE_DUE`; additive).

## 2026-11-16 · Completion with proof + customer confirmation

Replaces the Riot check for completing orders (Riot does not allow a public product on a development key). Decisions: end screenshots only (1–3), customer has 72 hours, a reported problem goes to an admin, booster loses login access while waiting.

- **Booster "Complete"** now asks for 1–3 screenshots of the final rank (shrunk in the browser, checked by their bytes on the server: PNG/JPG/WebP, 4 MB each, 4.4 MB total) and an optional note. If Riot confirms the target (LoL with an approved key), the order completes at once; otherwise it waits for the customer. Riot never blocks a completion any more.
- **New statuses:** order `AWAITING_CONFIRMATION`, assignment `SUBMITTED`. While waiting the booster keeps the order page and chat, has no login access, and can take another order.
- **Customer:** panel on the order page with the screenshots: "Confirm, all good" or "Report a problem" (reason). Notification + "please confirm" email. No answer in `auto_confirm_hours` (now 72) → confirmed automatically by the new `auto-confirm` job.
- **Admin:** new **Completions** page (and the same panel on the order page): disputed completions with screenshots and the customer's reason → "Complete order" or "Send back to booster" (note sent to both; order and login access come back).
- Screenshots are stored in the private Supabase Storage bucket `order-proofs` (created on first use) and served only through `/api/orders/[orderId]/proofs/[proofId]` to the order's customer, booster and admins.
- Migration `20261118120000_completion_confirmation` (new tables with RLS, new enum values; additive). Deploy guide: one more cron-job.org job (`auto-confirm`, every 15 minutes).

## 2026-11-16 · Order confirmed page and email

- **Checkout success page:** once the payment is confirmed, a receipt in the game's colours (game, service, current → target rank with emblems, details, options, price lines, discount, total paid) with "Open my order" and "Go to dashboard". Other states (checking, processing, cancelled, failed) unchanged.
- **"Order confirmed" email** to the customer with the same content and a link to the order. Queued by the payment webhook in the same transaction that marks the order paid (outbox `EMAIL_ORDER_CONFIRMED`, one per order, retried if Resend refuses).
- Shared builder `lib/orders/order-summary.ts`; `GET /api/orders/[orderId]/payment` returns `summary` once paid. Email template: `lib/email/order-confirmed.ts` (`renderEmailHtml` takes an extra block and an accent colour). No migration.

## 2026-11-15 · Production audit fixes

Audit: `docs/PRODUCTION_AUDIT.md`. Decisions: email through Resend; email confirmation is an optional reminder (nothing blocked); sessions stay 30 days.

- **Removed** the unused public endpoint `POST /api/orders/draft` and its in-memory store (anyone could fill the server memory).
- **Database:** row-level security on the last two tables (`verificationToken`, `_prisma_migrations`); migration `20261117120000_lock_remaining_tables` (applied).
- **Images:** all 21 images converted to WebP (10.7 MB to 0.7 MB); the link preview is `/images/og.jpg`.
- **Password reset:** `/forgot-password` asks for the email (same answer whether the account exists or not; 3 emails per address and 10 requests per IP an hour); the emailed link (`/reset-password`, 1 hour, single use, stored hashed) sets the new password, signs out every device and confirms the email.
- **Email confirmation (optional):** a confirmation email at sign-up (48-hour link, `/verify-email`); a reminder banner in the dashboard with "Send the email again" until confirmed. Google sign-ins count as confirmed.
- **Change password** card on the customer and booster profile pages (Google-only accounts can set one). Signs out the other devices.
- **Sign out everywhere:** new `user.sessionVersion`; every session lookup checks it. Migration `20261117180000_session_version` (applied 2026-11-15).
- **Email service:** `lib/email/send.ts` (Resend). Env: `RESEND_API_KEY`, `EMAIL_FROM`. Without them nothing is sent (in development the link is written to the server log).
- **Content-Security-Policy** in `next.config.ts`: only Supabase, Stripe, Google avatars, Riot Data Dragon, Sentry and Vercel analytics are allowed. `CSP_REPORT_ONLY=true` logs without blocking.
- **Rate limits:** quote, realtime auth, Riot ID check, Riot check, Riot sync and Riot test now use the shared (database) limiter.
- **Database pool** size is configurable: `DATABASE_POOL_MAX` (2 by default; 10 on an always-on server).
- `shadcn` moved to devDependencies.

**Tests:** 9 new (tokens, reset, verification, change password). 1048 pass.

## 2026-11-17 · Phase 9: admin, analytics, privacy, hardening

Decisions: build the Users list with booster directory, the Settings editor, the Live orders board and an analytics overview; account deletion and a cookie notice; rate limits and indexes. Not now: audit log viewer, data export, Playwright end-to-end tests.

**Admin screens** (the "Users", "Boosters" and "Settings" menu links were broken before)
- **Users:** search by name, email or id, filter by role, order counts, link to the booster page. Account deletion requests are listed at the top with "Delete account" / "Reject".
- **Boosters:** every booster with status (filter), identity check, games, active / limit, completed orders, rating, strikes in 30 days (red from 3) and unpaid fines.
- **Settings:** every config value with a short explanation, edited as JSON, validated before saving, reset to default, audited (`GET/PUT /api/admin/config`).
- **Live orders** (new menu entry): paid orders not finished, by state, coloured by waiting time: in the pool (amber after 30 min, red after 2 h), taken but not started (amber after 30 min, red after 60 min or a start warning), in progress (red when inactive), paused. Refreshes every 30 seconds.
- **Overview:** last 7 or 30 days: paid orders, revenue, platform margin, owed to boosters (all time), average time until an order is taken, completed / cancelled, start and inactivity warnings, top 5 boosters.

**Account deletion (GDPR)**
- "Delete my account" on the customer and booster profile pages. Refused while an order is open, a booster is working, a payout is in progress, or earnings are not paid out yet (the reasons are listed).
- An admin approves or rejects (rejection needs a note); audited.
- Approval anonymises: name ("Deleted user"), email, picture, password, sign-in links and sessions, booster application, bio, public name, payout method, saved game logins, Riot IDs and cached Riot profiles of their orders, notifications. Orders, payments, ledger, earnings and payouts stay (accounting), as do messages and reviews (shown as "Deleted user").
- New `deletedAt` on users: every session lookup ignores deleted users, so an open session stops working at once; password sign-in is impossible (no password, anonymised email).

**Cookie notice:** a small banner explaining that only necessary cookies are used and page statistics are anonymous and cookie-free; dismissed once per browser.

**Rate limits** (per user, shared limiter): bids 30/min, claims 10/min, payout requests 5/h, payout method changes 5/h, reviews 10/h, tips 10/h, cancellation requests 5/h, session starts 30/h, deletion requests 3/h. Over the limit: HTTP 429 "Too many requests".

**Indexes:** order (status, createdAt), assignment (booster, status), match (order, played by, win), message (sender, created at).

**Migration:** `20261117000000_account_deletion_indexes` (applied 2026-11-17).

**Tests:** 5 new against Postgres (deletion blockers and anonymisation, booster must cash out first, settings API validation and audit, directory / live board / analytics numbers, bid rate limit).

## 2026-11-16 · Phase 8: reviews, public boosters, tips

Decisions:

| | Decision |
|---|---|
| Built | Reviews, public booster profiles, tips |
| Tip commission | Same split as orders (current policy: 55 % booster, 45 % platform) |
| Winner of a bid | Still the lowest bid |
| Not built | Tiers, score-based award, Discord announcements |

**Reviews**
- On the order page, once the order is completed, the customer can leave 1 to 5 stars, preset tags (Very skilled, Fast delivery, Great communication...) and an optional text. One review per order, only by the customer who bought it.
- Review texts and replies go through the chat filter: contact and payment details become "[hidden]", since reviews are public.
- The booster is notified and can reply once. Admins can hide a review (with a reason, audited) or show it again; hidden reviews count nowhere.

**Public booster profiles**
- `/boosters`: active boosters who chose a public name, with their games and rank ceilings, completed orders and rating. A "Boosters" link is in the site header.
- `/boosters/<name>`: rating, five-star share, most used tags, recent reviews and replies. Never real names, emails or customer details.
- "Choose <name>" remembers the booster; the checkout preselects them when they can do the configured order (the existing 30-minute exclusive window applies after payment).

**Tips**
- After completion, the customer can tip 3, 5, 10 or another amount (1 to 500) from the order page; payment through Stripe Checkout.
- The Stripe webhook routes tip sessions by `metadata.kind = "tip"`; order payments are untouched. A replayed event changes nothing; a session whose amount does not match the tip is ignored.
- Ledger: the customer payment equals platform commission plus booster share (`TIP_PAYMENT`, `TIP_COMMISSION`, `TIP_BOOSTER_SHARE`). The booster share becomes a pending earning released by an admin like any other, then paid out normally. The booster is notified.
- Not handled automatically: refunds or chargebacks of a tip (do them in Stripe and adjust by hand).

**Migration:** `20261116180000_reviews_tips` (not applied yet).

**Tests:** 7 new against Postgres (review rules, filtered text, single reply, hidden reviews and summary, public list, tip limits, paid tip ledger and earning with replay, mismatched amount ignored).

## 2026-11-16 · Phase 7: payouts

Decisions:

| | Decision |
|---|---|
| Earnings | Manual admin approval kept (no automatic release) |
| Payout rules | Verified identity and a saved payout method are required; no minimum amount |
| Disputes | Not now (cancellation requests and support tickets stay) |
| Split between boosters | Suggested from progress; the admin confirms or changes it |

**Payout methods**
- A booster saves one method on the Cashout page: PayPal email, IBAN with account holder (checksum verified), or a crypto address (USDT TRC20, USDT ERC20, Bitcoin; checked against the network).
- Stored encrypted with the same key as account logins, bound to the booster (`encryptSecret`, context `payout-method:<boosterId>`). Only a masked hint is shown again, e.g. "IBAN FR76 •••• 0189".
- Replacing a method pauses payouts for 48 hours (config `payout_method_cooldown_hours`) and sends the booster a security notification. The first method does not lock anything.
- Each payout keeps a copy of the method used when it was requested, so a later change (for example by someone who took over the account) cannot redirect a payout already in the queue.
- Admins see the hint in the payout queue and press "Show details" to pay. Every view is counted on the payout and written to the finance audit log.

**Payout requests:** refused without a verified identity or a payout method, or while the method is locked. The Cashout page lists what is missing.

**Split suggestion:** on the finance page, "Earnings to allocate" is pre-filled with a split by progress: rank points gained (Riot rank snapshots) while each booster held the order, or wins played for Win Boosts. Progress lost counts as zero; with nothing measurable, the admin enters the amounts as before.

**Migration:** `20261116120000_payout_methods` (not applied yet).

**Tests:** 6 new against Postgres (IBAN / crypto / PayPal checks, masked hints, encryption, lock after a change, payout snapshot, admin-only audited reveal, identity check, split maths and rank-based split). Test boosters are now seeded with a verified identity and a payout method.

## 2026-11-16 · Live pages (no refresh needed)

Decisions: booster pages, customer pages and the notification bell update live (admin pages unchanged); if realtime is down, pages reload their data every 20 s; a new order in a booster's list shows a pop-up and says "halla moudir".

**How it works**
- Signals, not data: the server sends a small "something changed" event after the database write; the page refetches its own data, so the rank ceiling, the hidden customer price and all permissions still come from the server.
- Channels (Supabase Realtime, private, token per channel from `/api/realtime/auth`):
  - `private-pool` (new): boosters with access only. "pool.changed" when an order is paid (through the outbox), taken, released back, republished, or bid on.
  - `private-user:{id}`: already received "notification.created"; now every dashboard page listens to it (one subscription in the dashboard layout), plus "live.refresh".
  - `private-order:{id}`: new "order.updated" after a Riot sync with new games or a rank change, a session start / end, and login added / removed; the order page refreshes on it (and on assigned / started).
- Browser: `lib/realtime/live-client.ts` (`LiveChannel`: token refresh, reconnect with backoff, one refetch after reconnecting) and `components/realtime/LiveRefresh.tsx` (`useLiveRefresh`, `<LiveRefresh>`): debounced page refresh; 20 s polling while a channel is not live or realtime is not configured.
- Notification bell: reloads its list whenever the unread count changes.
- New order alert (available orders): pop-up "New order available" and the sound "halla moudir" (a clip at `public/sounds/new-order.mp3` if present, else the browser's speech). Silent until the booster clicks or types once on the page (browser rule); the pop-up says so.
- Admins: their bell is live too (the layout listens for everyone), which also refreshes the admin page they are on when a notification arrives.

**Tests:** 7 new (pool channel access, signals carry no data and never throw, browser channel signals / reconnect / refused token, payment / claim / bid send pool signals).

## 2026-11-16 · Prices shown to customers and boosters

- **Customer:** sees the full price they paid (unchanged).
- **Booster, available orders:** sees the payout after commission (e.g. 55 on a 100 order), the claim-now amount (25 % less, kept) and now the **current lowest bid**.
- **Visible bids (decision 2026-11-16):** a new bid must be lower than the lowest bid of the other boosters (`BID_NOT_LOWER`) and can never be above the payout. A booster may lower their own bid. Lowest bid wins when the window ends.
- **Booster, order page:** shows "Your payout" (the winning bid, claim-now amount or full payout). Boosters no longer receive the customer price at all (it was shown before).
- Tests: pool tests updated (visible lowest bid, refused equal / higher bids, order page payout vs customer price).

## 2026-11-15 · Phase 6: release, strikes, fines

Decisions:

| | Decision |
|---|---|
| Release | Within 10 minutes of taking the order and before starting: back to the pool, no penalty. Later: reason required, a strike, and DRAFT for admin review |
| Fines | Admins only, from a published schedule with suggested amounts; boosters can appeal |
| Strikes | Counted and shown; no automatic suspension |
| Inactivity | 12 hours with no games and no messages: the booster and admins are warned; no automatic release |

**Release**
- A free release puts the order straight back in the pool, in a new bidding round. Any margin the platform kept on that booster's payout goes back into the booster share, so the next booster sees the full payout. A trial booster gets their trial order back.
- A late release gives a LATE_RELEASE strike (the booster is notified) and moves the order to DRAFT, as before.
- If the leaving booster ever viewed the login, the order history notes that the customer should change the password.
- The order page shows "Free release until HH:MM" while the window is open (reason optional), otherwise warns about the strike.

**Strikes:** from late releases, missed starts (60 min) and every fine. Shown on the booster's new **Rules & Fines** page and on the admin booster page, where admins can remove one with a reason.

**Fines**
- Schedule in config `fine_schedule` (not started in time, dropped after starting, contact shared, customer requests ignored, account changes, toxic behaviour, other).
- An admin picks the order, rule and amount and writes a note. Ledger: the booster payable goes down, platform revenue up (`BOOSTER_FINE`). A FINE strike and a notification follow.
- Unpaid fines are taken off the booster's next payout request (the payout shows how much). A rejected or failed payout makes them due again. Fines under appeal are not taken off and do not block payouts.

**Appeals:** the booster appeals each fine once with an explanation. Admins decide on the new **Fines** page: accept (fine reversed: opposite ledger entry, strike removed; if it was already paid out, the amount comes back as an available earning) or reject (upheld). Admins can also reverse a fine directly.

**Inactivity:** part of the `sla-warnings` job. Activity = a booster game, a booster message, a session, a resume or the start.

**Migration:** `20261116000000_strikes_fines_inactivity` (not applied yet).

**Tests:** 9 new against Postgres (free and late release, margin and trial given back, fines and ledger, payout deduction and rejection, appeals and refunds, missed start strike, inactivity once, activity resets).

## 2026-11-15 · Phase 5: Riot tracker

Decisions:

| | Decision |
|---|---|
| Who played | Only games played inside the booster's sessions count for the order |
| Alerts | Games during a pause or outside a session: admins are notified, no automatic penalty |
| Valorant / TFT | Left for later (no code yet), until the needed API keys are available |
| Retention | Match and rank history deleted 15 days after the order ends |

**Who played each game**
- The sync now looks for ranked games over the whole time a booster holds the order, including pauses, and labels each one: **booster** (inside a session), **customer** (outside one) or **paused** (during a pause).
- Only booster games count toward win boosts, the win/loss count and the Complete check. The other games are still listed with a "Not booster" / "During pause" tag.
- Orders started before sessions existed keep the earlier rule (any game while the booster held the order and it was not paused).

**LP per game**
- New `OrderRankSnapshot` table: a snapshot after each sync when the rank changed or new games were found.
- When exactly one new ranked game of that queue started after the previous snapshot, it gets the LP change (promotions included). Otherwise no LP is shown, rather than a guess.

**Alerts:** each game during a pause or outside a session adds an order event and notifies admins once ("Game outside a session").

**Retention:** a daily job (`tracker-retention`, 03:30) deletes match history and rank snapshots, and clears the cached Riot profile, 15 days after an order is completed or cancelled (config `match_retention_days`). The order, its Riot ID and all money records stay.

**Provider switch:** config `tracker_provider` set to anything other than `riot` turns the Riot sync and auto-refresh off.

**Riot legal notice:** "not endorsed by Riot Games" added to the site footer.

**Migration:** `20261115180000_tracker_attribution_snapshots` (not applied yet). Existing matches keep counting for the booster.

**Tests:** 6 new (who played a game, legacy rule, attribution, LP per game with promotion, alerts once, retention boundaries).

## 2026-11-15 · Phase 4: workspace, vault, chat, completion

Decisions:

| | Decision |
|---|---|
| Completion | The booster's "Complete" checks the account with Riot against the purchased target. Reached: the order completes. Not reached: admins are notified and the booster is told to keep going and that an admin will contact them |
| Sessions | Required before the login can be revealed |
| Chat filter | Contact and payment details are hidden and flagged |
| Screenshots | Not now |

**Complete with a Riot check**
- `lib/orders/completion-check.ts` refreshes the account from Riot, then compares:
  - League of Legends rank services: current rank against the target rank (the Riot data must be under 15 minutes old).
  - Win Boost: tracked wins against the wins ordered.
- Not reached, or cannot be checked (Valorant, TFT, placements, normal matches, mastery, arena, or no fresh Riot data): the order stays in progress, an order event is recorded, admins get a "Completion needs review" notification (at most once per hour per order) and the booster sees a modal.
- Admins have a "Complete order (admin)" button on the order page (no Riot check).
- Progress is computed by one shared function (`lib/orders/order-progress.ts`) for the order page and the check.

**Sessions and the login**
- The booster starts a session and accepts the session rules (play only during the session, respect the customer's requests, change nothing on the account, keep the login private, stop on pause). The customer is notified and sees "your booster is playing now".
- The login can only be revealed during an open session. Every reveal is logged with the session, the IP and the browser.
- Sessions end when the booster ends them, the customer pauses, the order is completed, released, reassigned or cancelled, or after 12 hours.
- Duo orders: the customer cannot save a login and nothing can be revealed.

**Chat filter**
- Emails (also "name at gmail dot com"), phone numbers, Discord invites and handles, Telegram / WhatsApp / Snapchat / Instagram / Skype, and payment details (PayPal, Cash App, Venmo, Revolut, Skrill, Zelle, IBAN, Bitcoin and Ethereum addresses) become "[hidden]" before the message is stored or shown.
- The sender sees a notice. The original text is kept for admins only, on the new **Chat Flags** admin page, and admins are notified. Admin messages are not filtered.

**Fixes on the way**
- Booster pages no longer receive the customer price (the old full order rows caused the "Decimal objects are not supported" error).
- Saving a paid draft order works again: the paid price is shown read-only and not sent back.

**Migration:** `20261115120000_sessions_reveals_chat_flags` (not applied yet).

**Tests:** 9 new against Postgres (chat filter cases and false positives, flagged message storage, Complete reached / not reached / stale / unsupported, admin completion, sessions and reveal log, pause ends the session, duo). The Riot completion check is replaced by a pass-through in other test files (`__tests__/setup.ts`).

## 2026-11-15 · Phase 3: pool, rank ceiling, bidding

Decisions:

| | Decision |
|---|---|
| Claim model | Sealed bids: the first bid opens a 1-minute window (config `bid_window_sec`), the lowest bid wins, ties go to the earliest |
| Claim now | Any booster can skip bidding and take the order at the payout minus 25 % (config `claim_now_discount_bps`) |
| Priority orders | No bidding; claimed instantly at the full payout |
| Order limit | 1 active order per booster (config `max_concurrent_orders`); an admin can raise it per booster |
| SLA | Warnings only: 5 min to message the customer, 60 min to start. No automatic release |
| Preferred booster | The customer can pick a booster at checkout; that booster has the order alone for 30 min (config `preferred_booster_window_min`) at the full payout |

**Pool [F9]**
- Boosters only see paid orders they are allowed to take: game, service, region and rank ceiling (`lib/pool/eligibility.ts`). The same check runs on bids and claims, so a direct link does not bypass it.
- Cards show the booster's payout, the claim-now amount, the time left and the number of bids. Never the customer price or name (the old pool sent the customer's name).
- A booster never sees an order they held before.

**Bids and award [F12]**
- New `OrderBid` table; one bid per booster per round, can be changed or withdrawn while open; amounts are never shown to other boosters.
- When the window ends the order goes to the lowest bid. A winner who can no longer take it (limit reached, status changed) is skipped. No usable bid: the round stays open.
- Closed by the `close-bidding` job every minute and also whenever the pool is loaded.
- Each time an order goes back to the pool it starts a new round.

**Taking an order**
- New order status **CLAIMED**: taken but not started. The booster presses **Start order** (CLAIMED to IN_PROGRESS) or **Release**.
- One transaction for every way of taking an order (`takeOrderTx`): booster row locked, limit and trial checked, order moved only if still in the same round.

**Money**
- When the agreed payout is below the reserved booster share, the difference moves to the platform (`BOOSTER_BID_MARGIN` ledger entries) and the booster's reservation is reduced.
- Refunds after that follow the agreed payout; the platform side covers the rest.
- If part of the share was already refunded before the order was taken, no margin is taken.

**Preferred booster**
- Boosters set a public name on their profile (never the real name). Checkout lists active boosters with a name who are allowed to do that order.
- After payment, the chosen booster is notified and has the order alone for 30 minutes.

**SLA [F11]:** the `sla-warnings` job warns the booster after 5 minutes without a message, and the booster and admins after 60 minutes without a start. Each warning is sent once.

**Admin:** active-order limit per booster on the booster page.

**Notifications:** order offered, bid won, bid lost, SLA warning.

**Fix:** an unpaid order now says "payment has not been verified" instead of "order is PENDING, expected PENDING".

**Cron:** `close-bidding` runs every minute. Vercel's Hobby plan only allows daily crons; the pool also closes windows itself when it is loaded, so bidding still works there.

**Migration:** `20261115000000_pool_bidding_claimed` (not applied yet).

**Tests:** 15 new against Postgres (eligibility, pool visibility, claim now and margin, start and complete, limit, bids and ties, skipped winner, reopen, new round, priority, preferred, SLA, refund after margin). Updated the claim tests for CLAIMED and the transition table.

## 2026-11-14 · Phase 2: booster onboarding, permissions, rank ceiling

Decisions:

| | Decision |
|---|---|
| 2FA | Skipped for now |
| Proof of rank | Links only (https), no uploads |
| Trial | New boosters start with 3 trial orders (config `booster_trial_orders`) |
| Existing boosters | Ceiling = the peak rank in their application (backfill script) |

**Booster statuses [F23]**
- New statuses: UNDER_REVIEW, NEEDS_INFO, TRIAL, ON_BREAK, TERMINATED (PENDING = submitted, APPROVED = active).
- Every status change goes through `transitionBooster()` (`lib/boosters/transitions.ts`): a table of legal moves and who may make them (admin or the booster), a conditional update, a `BoosterEvent` and an audit row.
- An admin must write a note to request info, reject, suspend or terminate. Admins cannot review themselves.
- Booster access (`hasBoosterAccess`): APPROVED, TRIAL, ON_BREAK. New orders (`canClaimNewOrders`): APPROVED, or TRIAL with orders left. Each trial claim uses one order (conditional, never below 0).

**Rank ceilings [F24]**
- `BoosterPermission` per game: highest target rank (rank value), regions and services (empty = all).
- Default from the application's peak rank when a booster is approved. Admins set or remove them; a booster can only lower their own.
- Stored only for now: the order pool applies them in Phase 3.

**Applications**
- Each game needs a proof link (https). The rules version is stored on submit.
- Boosters asked for more info, or rejected, can re-submit; pending ones cannot submit twice; suspended and terminated ones cannot apply.

**Screens**
- Admin booster page `/dashboard/admin/boosters/[userId]`: status actions from the table, application with proof links, ceiling editor, identity check, history.
- Booster profile: status, trial orders left, break switch, lower a ceiling, start identity check.
- Applicant view shows "under review" and "more information needed" with the admin's note.

**Identity check:** `KycProvider` interface with a mock; an admin records the result.

**Fix:** a config read inside a transaction now goes through that transaction (`getConfigIn`), so it never needs a second connection.

**Migration:** `20261114220000_booster_lifecycle_permissions` (not applied yet). Then run `npx tsx scripts/backfill-booster-permissions.ts` (dry run first).

**Tests:** 13 new against Postgres (status helpers, transition table, notes, trial approval, self-review, ceilings, trial claims, break, apply route). Total 961, all passing.

## 2026-11-14 · Phase 1: pricing and customer ordering (finish)

Decisions:

| | Decision |
|---|---|
| D1 | Admin-reviewed cancellation request |
| D2 | Accounts only, no guest checkout |
| Email | No email provider for now, so password reset and email verification are deferred |
| Legal pages | Placeholders |

**Estimated completion [F2]**
- Added `lib/pricing/eta.ts`: hours per division by tier, per win and per match.
- Low LP gain, duo mode and Priority adjust the time. Labelled "about N hours" or "about N–M days".
- Tunable through config `eta_model`. Returned with the quote and shown under the total.

**Coupons [F2, F3]**
- Added the `Coupon` table (percent or fixed amount, cap, minimum order, total uses, uses per customer, game/service scope, start/end dates, active flag).
- Pure rules in `lib/pricing/coupons.ts`.
- **Platform-funded:** the booster share is computed on the price before the discount, and the discount is capped at the platform fee.
- A code that is no longer valid stops order creation (409) rather than charging a different price.
- Admin page at Finance › Discount codes, with an API, and every change audited. Discount field in checkout.

**Risk notice**
- Required checkbox at checkout. `riskAccepted` is required when an order is created.
- The order stores `riskDisclosureAcceptedAt` and `riskDisclosureVersion` (text in `lib/orders/risk-disclosure.ts`).

**Cancellation requests (D1)**
- Customers click "Request cancellation" with a reason, and can withdraw it.
- An admin approves (cancel the order, revoke the booster's access, refund the amount the admin sets through the normal Stripe refund) or rejects with a note.
- At most one open request per order (partial unique index). Order-page banner. Admin page under Cancellations.

**Placeholder pages:** `/terms` (includes the risk text), `/privacy`, `/forgot-password`.

**Tests:** 26 new (ETA 5, coupons 12, coupons, risk and cancellation against Postgres 9). Total 948, all passing.

**Migration `20261114200000_coupons_risk_consent_cancellation` (not applied)**
- Required: until it is applied, order creation and the order page fail (new columns and table).

## 2026-11-14 · Phase 0.B: foundation gaps

**Order status changes [F4 v1]**
- Added `lib/orders/transitions.ts`: one table of legal order transitions plus `transitionOrder()` (single row) and `transitionOrders()` (many).
- All 14 order status writes now go through it, with their existing conditional `where` clauses unchanged. A write without a status condition, or an illegal move, is refused before it reaches the database.
- 64-cell table test.

**Rank scale [F1 v1]**
- Added `lib/domain/rank.ts`: `rankValue`, `rankScale`, `compareRanks`, `nextRank`, one numeric scale per game (LoL Iron IV = 0 … Diamond I = 27, Master = 28; VALORANT Radiant = 24).

**Config [F18 v1]**
- Added the `AppConfig` table and `lib/config`: typed keys with zod schemas and defaults, admin overrides, audited `setConfig`.
- Reads never fail: missing or invalid values, or a missing table, fall back to the defaults.
- Now read from config: LP price brackets, checkout-hold TTL, Riot full-refresh interval.

**Audit log**
- Added the `AuditLog` table and `audit()` in `lib/audit.ts`. Inside a transaction it is atomic with the change; without one it is best effort.

**Jobs**
- Added the `JobLease` table, `lib/jobs` (lease + registry), the `GET /api/cron/[job]` route (Bearer `CRON_SECRET`, refused when unset) and `vercel.json` schedules.
- First jobs: `outbox-dispatch` every 5 minutes, `close-stale-holds` every 15 minutes.
- Note: Vercel Hobby plans run cron at most once a day.

**Providers [F7 interface, F14 v1]**
- `lib/providers/rank.ts`: `RankProvider`, `RiotRankProvider`, `MockRankProvider`, and `getRankProvider()` chosen by config `tracker_provider`.
- `lib/providers/payment.ts`: `PaymentProvider` + Stripe.
- `lib/providers/mail.ts`: `Mailer` + log and fake mailers.
- `lib/providers/notify.ts`: `Notifier` (in-app).
- Existing code is not moved onto these yet (Phases 1, 5 and 10).

**Monitoring**
- Added `@sentry/nextjs` 11.12.0, wired in `instrumentation.ts`, `instrumentation-client.ts`, `app/error.tsx` and `app/global-error.tsx`.
- It is off unless `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is set.
- `lib/monitoring.ts` turns off collection of cookies, headers, request bodies, user info, query strings and database query data.

**Lint and CI**
- Fixed the real lint errors:
  - a hook called after an early return (`faq-accordion`)
  - writing to `window.location` directly
  - `<a>` tags used for internal links
  - unescaped quotes
  - empty interfaces
  - `prefer-const`
- 30 legacy files keep `no-explicit-any`, and 7 keep `set-state-in-effect`, as warnings on an explicit list in `eslint.config.mjs`.
- `npm run lint` now passes with 0 errors.
- Added `.github/workflows/ci.yml` (typecheck, lint, tests).

**Tests**
- The in-memory test database now applies every migration after the payments one, so the credentials and foundation migrations are checked on every run.
- New tests: rank (12), transitions (69), config (4), jobs + cron route (4), providers (3).

**Migration `20261114180000_foundation_config_audit_jobs` (not applied)**
- Adds `appConfig`, `auditLog` and `jobLease`, with RLS enabled.
- Until it is applied, config falls back to its defaults, `audit()` without a transaction logs a warning, and cron jobs fail.
