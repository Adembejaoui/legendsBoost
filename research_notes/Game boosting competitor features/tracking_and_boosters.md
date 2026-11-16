# Post-purchase experience and booster side of game boosting competitors (LoL / Valorant / TFT), researched Nov 2026

Research notes. Pages that could not be loaded: gameboost.com/become-a-booster (HTTP 403), eloboost.net (HTTP 521, server down), boostingfactory.com (403), overgear.com (403), boostroyal.com/work-with-us (404), eloking.com/faq (404), help.gameboost.com "Financial Transactions and Policies" (403; known only from a search snippet). Skycoach's LoL boost page loaded but showed only pre-purchase content. ggboost and lolboost were not fetched because of the tool budget. Most feature claims come from vendors' own marketing pages and were not independently verified.

## 1. Customer dashboards: what they show; mobile apps and Discord

### Takeaway
Competitors sell a live order view (a "Members Area" or dashboard with game-by-game updates), a paid streaming add-on with a private link, and in BoostRoyal's case iOS/Android dashboard apps. LP graphs, ETAs and screenshot galleries were not documented on any page that loaded. One older review says Elo-Boost.net showed each booster's recent match history and achievements.

### Cited Findings
- Eloking: "The moment you order, your Members Area lights up with live progress"; you can "track every win as it lands." A booster messages the customer within 30 minutes of ordering. — [eloking.com](https://www.eloking.com/)
- Eloking: optional **streaming add-on**, "watch your games played in real time through a private link." — [eloking.com](https://www.eloking.com/)
- BoostRoyal: "Follow every match in real time from your dashboard"; the site links **iOS and Android dashboard apps** (their features aren't described). Streaming is a checkout add-on that raises the price. Wallet cashback runs 3–8% by tier. — [boostroyal.com](https://www.boostroyal.com/)
- BoostRoyal FAQ: "We will send you a notification when your order is complete." — [boostroyal.com](https://www.boostroyal.com/)
- Elo-Boost.net (per a third-party review summarised in search results): a "booster match history feature" lets customers inspect games their boosters recently carried, plus a booster profile page with ranks and achievements. VPN is used, but offline mode isn't offered. A Trustpilot reviewer praised "Live updates game by game." — [Trustpilot elo-boost.net](https://www.trustpilot.com/review/elo-boost.net); [thexboxhub](https://www.thexboxhub.com/?p=128810). The search returned these as snippets only; the dates are unclear, and it is unclear whether this is the same operator as eloboost.net.
- Boosteria: the homepage has only a "Customer Area" login (email/password or Google), a "Preferred Chat Nickname" at signup, plus "Premium," "Loyalty" and per-game "Demo" pages. The dashboard isn't described on the homepage. — [boosteria.org](https://boosteria.org/)
- Eloboss (a different platform) press release, Dec 2025: users can "track service progress, communicate securely with assigned professionals, and view detailed activity records tied to each order," plus an incentivized customer program. — [financialcontent press release](https://markets.financialcontent.com/postgazette/article/newsfile-2025-12-4-eloboss-expands-all-in-one-game-support-platform-with-new-titles-and-incentivized-customer-program)
- ZeusX (a marketplace) has iOS/Android apps with push notifications. — [turbosmurfs.gg](https://turbosmurfs.gg/article/gameboost-alternatives)

### Inferences
- The table-stakes set is a live per-game progress view plus chat. The visible differentiators are a **live stream / private watch link**, **mobile apps with push**, and a **cashback wallet** (BoostRoyal).
- The app already has Riot API rank/match tracking, which likely matches or beats the "live progress" these sites market. A paid stream add-on, a native or PWA mobile client with push, and an order timeline are the visible gaps.

### Gaps
- No page that loaded showed an LP-over-time graph, ETA estimates, screenshot uploads or a timeline UI. Dashboard screenshots weren't retrievable because of the 403/521 errors.
- No customer-facing Discord bot was found for any LoL boosting site. Eloking only links a Discord server.

## 2. Booster selection: picking a booster, profiles, ratings, champion pools, languages, online status, favorites

### Takeaway
The richest documented model is BuyBoosting: a public booster directory with ratings, reviews, games, languages, online dot, completed-order count, and a "Book" button that falls back to the pool after 4 hours. Eloking and Skycoach don't offer browse-and-pick. Eloking customers informally "prioritize" favorite boosters, and Skycoach reassigns a preferred PRO only on request through live chat. BoostRoyal shows rating and order counts on booster profiles and lets customers request roles or champions.

### Cited Findings
- BuyBoosting booster cards show:
  - **star rating with review count** (e.g. "★ 5.00", "58 reviews"), and only customers whose order the booster worked on can rate
  - **games** played
  - **languages**, filterable (e.g. "English · Serbian")
  - **online status**: a green dot means active on Discord or the booster dashboard in the last 15 minutes, and "Open order slot" means not away with a free slot; there is an "Online now" sort
  - **completed orders** (e.g. "157 orders")
  - a **Coach tag** for boosters who also do duo or coaching

  "Book" creates an order for that booster. If it isn't started within **four hours**, it is released to the general pool. Customers can also skip choosing. There is no favorites or rehire list, only reassignment through support. — [buyboosting.com/boosters](https://buyboosting.com/boosters/). A summary of a different BuyBoosting page says orders go to the pool without choosing, so the site's own pages conflict on this. — [search summary](https://buyboosting.com/boosters/?game=cod)
- BoostRoyal: public booster profiles with rating and orders done (e.g. "4.94" with "1,578 orders done") and a "Verified" tag. Boosters pass "a multi-stage verification." Customers can request roles or champions at checkout. The site rating is 4.86 from 79.4K reviews. — [boostroyal.com](https://www.boostroyal.com/)
- Eloking: you choose a boost and target rank, not a booster. "Every booster is screened for attitude, not just rank." — [eloking.com](https://www.eloking.com/). Trustpilot reviewers name boosters and re-request them ("Stathis has been an incredible booster, and I always prioritize him," Sep 2024). — [Trustpilot eloking](https://www.trustpilot.com/review/eloking.com)
- Skycoach: the page shows "Buy from PRO" labels and promises an "immediately contact with PRO player" for custom orders. — [skycoach.gg/lol-boost](https://skycoach.gg/lol-boost). The company tells reviewers they can ask in live chat for a specific PRO on the next order, and that a PRO is "usually" assigned in 10–15 minutes. Reviewers say support discouraged switching PRO mid-order, citing delays. — [smartcustomer.com Skycoach](https://www.smartcustomer.com/reviews/skycoach.gg?page=8); [Trustpilot skycoach](https://www.trustpilot.com/review/skycoach.gg?page=7)
- Champion selection add-ons: Boosteria offers a "Choose Champions Booster" option (per the search summary). Other sites let customers request preferred champions or roles. — [mitchcactus.co](https://mitchcactus.co/?p=207961); [boostroom.com](https://boostroom.com/games/league-of-legends/boosting/popular)

### Inferences
- A booster directory with booking, online status and a slot indicator, plus "rehire this booster," is a real gap at most LoL sites. Only marketplace-style sites (BuyBoosting, GameBoost) expose it. A one-click "request same booster again" would formalize what Eloking and Skycoach customers already do through support.
- The 4-hour auto-release to the pool is a pattern worth copying if direct booking is added.

### Gaps
- No site was confirmed to show champion pools or mains on booster profiles. BuyBoosting lists games only.

## 3. Communication: chat, appear offline, Discord, notifications

### Takeaway
Direct customer–booster chat and offline mode are standard. Eloking states boosters play in offline mode, and BoostRoyal offers "Strict Offline Mode" free on every order. GameBoost requires all buyer–seller communication to stay inside its chat and gives sellers Discord-webhook alerts. Customer-side email/SMS/push is rarely documented beyond "notification on completion" and the mobile apps.

### Cited Findings
- Eloking: "Chat directly with your booster, message management to change anything mid-order." Boosters play "in offline mode so you stay invisible to your friends list." — [eloking.com](https://www.eloking.com/)
- BoostRoyal: "Strict Offline Mode," "free on every order." Support runs over live chat, phone and tickets. A sample chat shows a customer asking the booster to duo. — [boostroyal.com](https://www.boostroyal.com/)
- GameBoost: "All communication must stay within GameBoost's chat system." Advertising other contact methods can lead to suspension. Sellers can receive order and message alerts on-platform or via **Discord webhooks**. A full **API** is available for managing offers and orders. — [docs.gameboost.com Partner FAQ](https://docs.gameboost.com/documentation/for-sellers/partner-faq)
- Pain points from Eloking reviews: "Booster is afk and dont respond" (Oct 2026). One customer waited about 2 hours after the booster asked for a break (Apr 2026). Live support has become "basically sending emails" and "does not work anymore" (Apr 2026). An order sat "ready for pickup" for 48 hours (Mar 2026). — [Trustpilot eloking](https://www.trustpilot.com/review/eloking.com)

### Inferences
- The app's in-app notifications could be extended with email or push for game-by-game updates and with booster-unresponsive SLAs. Complaints show that booster responsiveness and pickup delays drive negative reviews, so response-time SLAs, auto-reassignment after N hours unclaimed, and a "booster away" status are valuable.
- Discord webhooks for boosters (new claimable order, new message) are a cheap win that GameBoost already offers.

### Gaps
- No confirmed SMS notifications at any site. Customer-side Discord integration wasn't verified.

## 4. Tips, booster ratings after completion, review requests

### Takeaway
Post-order booster ratings appear on marketplace-style sites. BuyBoosting restricts ratings to customers whose order the booster worked on, and BoostRoyal displays booster ratings. Most sites push customers to Trustpilot for reviews. A booster-tipping feature wasn't documented on any page loaded.

### Cited Findings
- BuyBoosting: a rating can only come from a finished order, and reviews cover "communication and speed." — [buyboosting.com/boosters](https://buyboosting.com/boosters/)
- BoostRoyal displays per-booster ratings such as 4.94. — [boostroyal.com](https://www.boostroyal.com/)
- Skycoach sends customers to Trustpilot ("check our Trustpilot page and read tons of reviews"). It has 24.8K Trustpilot reviews. — [skycoach.gg/lol-boost](https://skycoach.gg/lol-boost); [Trustpilot skycoach](https://www.trustpilot.com/review/skycoach.gg?page=7)
- GameBoost: disputes resolved in the buyer's favor "can affect metrics and ranking" of sellers. — [docs.gameboost.com Partner FAQ](https://docs.gameboost.com/documentation/for-sellers/partner-faq)
- Customers value boosters who teach while boosting: one Eloking booster "gave me tips on how to improve my own gameplay" (Mar 2026). — [Trustpilot eloking](https://www.trustpilot.com/review/eloking.com)

### Inferences
- A post-completion flow with three steps (rate booster, optional tip, then a Trustpilot prompt for happy customers) combines patterns seen separately across competitors.

### Gaps
- No source confirmed an in-app tipping feature at any LoL boosting site. Not found does not mean absent.

## 5. Booster side: order distribution, levels, payouts, vetting, penalties, dashboards; GameBoost's model

### Takeaway
GameBoost runs a verified "Partner" marketplace:
- **Verification:** ID, proof of residency and a signed contract.
- **Applications:** through jobs.gameboost.com as seller or booster.
- **Fees:** a rank-based platform fee.
- **Withdrawals:** €100 minimum, a 30-day hold for new partners, and method fees.
- **Inactivity:** auto-unlisting after 7 days, suspension after 14 days.
- **Response SLAs:** reply within 12h, resolve within 24h.
- **Orders:** auto-completion after 24h of buyer silence.
- **Disputes:** affect search ranking.

Traditional LoL sites (BoostRoyal, Eloking) describe handpicked Challenger-level boosters. Their internal claiming and payout rules weren't publicly documented on any page loaded.

### Cited Findings
- GameBoost scope: a marketplace for accounts, items, currencies and gaming services (boosting), established 2022. Trustpilot categories: GameKeys, Gift Cards, Accounts, Items, Currency, Boosting. — [ibtimes.co.uk](https://www.ibtimes.co.uk/partner/gameboost); [Trustpilot gameboost](https://au.trustpilot.com/review/gameboost.com?page=6)
- GameBoost partner rules: — [docs.gameboost.com Partner FAQ](https://docs.gameboost.com/documentation/for-sellers/partner-faq)
  - Full verification is required before listing or withdrawing. Partners must be 18+, and multiple accounts need permission.
  - Search ranking depends on **Partner rank, performance metrics and listing quality**. "Higher-ranked partners pay a lower platform fee."
  - Inactivity: 7 days → all listings unlisted; 14 days → suspension; 7 days with no new offers → suspension. A "seller break" prevents unlisting.
  - Delivery must happen within the guaranteed time, or with buyer approval. Late delivery "may entitle the buyer to a full refund." Partners reply to issues within 12h and resolve within 24h, or staff may refund.
  - "Orders complete automatically after 24 hours if the buyer does not respond." "Orders cannot be cancelled independently."
  - Disputes are formal reviews with evidence and escalation.
  - Withdrawals: €100 minimum. Bank (incl. Wise/Payoneer/Revolut) 4% + €4, Skrill 5% + €1, crypto 6% + €10. New partners have an extra 30-day hold. A failed withdrawal costs a €50 fee.
  - Discord-webhook alerts and an API.
- GameBoost applications go through jobs.gameboost.com (choose seller or booster), are reviewed against standards, and approved applicants receive onboarding. — [docs.gameboost.com How to sell](https://docs.gameboost.com/documentation/for-customers/frequently-asked-questions/how-do-i-sell); [help.gameboost.com Seller Verification Guide](https://help.gameboost.com/articles/7930156-seller-verification-guide)
- An older or conflicting help article (seen only as a search snippet; the page itself returned 403) says sellers keep **80% of sale price plus €0.99 per sale**, with payouts twice monthly (15th and 30th). — [help.gameboost.com Financial Transactions](https://help.gameboost.com/en/articles/9655167-financial-transactions-and-policies). This conflicts with the Partner FAQ, which says fees vary by rank and gives no schedule. SteamDB reports a 0% seller fee, a 4% buyer fee, payouts within hours, and KYC required. — [steamdb.com GameBoost](https://steamdb.com/en/markets/gameboost)
- Comparable marketplace fees: Eldorado charges 5% on Currency and 10% on Accounts, Items and Boosting. — [Eldorado fees](https://intercom.help/eldoradogg/en/articles/8409025-fees). G2G requires seller ID verification, may require security deposits, and restricts or removes low-rated sellers. — [turbosmurfs.gg](https://turbosmurfs.gg/article/gameboost-alternatives)
- BoostRoyal boosters must be Challenger with prior boosting or pro experience, and are "handpicked." — [boostroyal.com](https://www.boostroyal.com/)
- An industry estimate puts boosting organizations' cut at about 15–20% of the booster's earnings. This is an Eloking blog article, not a policy. — [medium.com/eloking-news](https://medium.com/eloking-news/how-much-do-boosters-make-for-boosting-in-league-of-legends-93f51b02ab4c)
- BuyBoosting's online status reads activity on "the Discord server or booster dashboard," and boosters can mark themselves "away" and have order slots. — [buyboosting.com/boosters](https://buyboosting.com/boosters/)

### Inferences
- Patterns the app may lack:
  - **booster rank or levels tied to fee/commission tiers** and search or claim priority
  - **an away/break mode**
  - **concurrent order slot limits**
  - **an inactivity auto-unlisting rule**
  - **response SLAs with automatic refund or reassignment**
  - **a hold period for new boosters' earnings** as anti-fraud
  - **a minimum withdrawal with per-method fees**
  - **dispute workflow with evidence that affects booster metrics**
  - **Discord webhooks / API for boosters**
- Auctions or bidding on boosting orders were not found at any source.

### Gaps
- Internal booster panels at Eloking, BoostRoyal, Skycoach and BoostingFactory (claiming rules, strikes, payout cadence) weren't publicly documented. The work-with-us pages returned 404 or 403. A search for booster panel, payout and strike policies returned only unrelated LoL patch news.
- GameBoost's exact rank-based fee percentages weren't found.

## 6. Account marketplaces (smurfs) and coaching marketplaces

### Takeaway
Ready-made accounts are a core adjacent product. GameBoost sells them through verified partners with category listing rules. TurboSmurfs specializes in LoL, Valorant and Marvel Rivals accounts with ban-history checks, a 30-day warranty and rich filters. Coaching shows up as a booster attribute ("Coach tag", duo) rather than a separate marketplace at the sites checked.

### Cited Findings
- GameBoost partners list accounts under category rules (Account Seller Rules, GTA V listing rules). Original descriptions are required except for standard smurf templates. Listings are removed for misleading descriptions or flagged keywords. — [docs.gameboost.com Partner FAQ](https://docs.gameboost.com/documentation/for-sellers/partner-faq)
- TurboSmurfs checks each account (including ban history) before listing and gives a 30-day warranty with a full refund. Filters cover rank, champions, Blue Essence, skins and region. — [turbosmurfs.gg](https://turbosmurfs.gg/article/gameboost-alternatives)
- BuyBoosting boosters with a "Coach tag" also offer duo or coaching. — [buyboosting.com/boosters](https://buyboosting.com/boosters/)
- AccountShark "Three ways to earn" seller page: a seller program for accounts (title only seen in search). — [accountshark.net/sell](https://accountshark.net/sell)

### Inferences
- If the app expands, an accounts catalog with warranty, ban-history checks and filters, plus booster-run coaching sessions sold from booster profiles, would reuse the existing booster marketplace and Riot API verification (rank checks on listed accounts).

### Gaps
- Skycoach and Overgear coaching or account pages couldn't be loaded (Overgear 403; the Skycoach page showed no such content). Coaching marketplace details (hourly pricing, VOD review) remain unverified.
