# Competitor Services, Order Configuration and Add-on Pricing (LoL / Valorant / TFT boosting sites)

Method note: pages were fetched on 2026-11-14 with an HTML-to-text fetcher, so JavaScript-rendered prices and some option values may be missing. The fetcher returned no prices for most add-ons (configurator totals showed €0.00 or blank until configured). Pages that failed to load:
- lolboost.net (DNS failure)
- eloboost.net (HTTP 521)
- boostingfactory.com/league-of-legends/elo-boost (403)
- overgear.com/games/league-of-legends (403)
- skycoach.gg/lol-boost/rank-boost and /elo-boost (404)
- eloking.com/lol-boost/rank-boost, /division-boost and eloking.com/valorant-boost (404). The working Eloking URLs are /lol-boost, /lol-boost/divisions and /lol-boost/wins.
- boostroyal.com/lol-boost, /lol-boost/division-boost (page showed "Error Loading Data", 403 "Game type not found") and /faq (404)
- lolboosting.net (DNS failure)

## 1. Which service types do competitors sell? Which are most common?

### Takeaway
Every site sells rank/division boost, placements and wins. Most also sell coaching, normal games, account leveling or accounts, and duo/"games" products. Less common services are Master+ LP boosting (Boosteria), hire-a-teammate or hourly sessions (Eloking), Valorant "Girl Duo" (BoostRoyal), TFT Set/Battle Pass boosting (BoostRoyal, Skycoach), and a LoL Classic or Wild Rift catalogue (GGBoost, Skycoach, Boosteria). Net wins, where each loss is repaid with extra games, is the standard way wins are sold.

### Cited Findings
**GameBoost**
- LoL boosting tabs: Rank Boost, Win Boost, Placements Boost, Arena Boost, Normal Matches and Champion Mastery. The site also sells Accounts, Items, RP top-up and Gift Cards. — [GameBoost LoL](https://gameboost.com/league-of-legends/boosting/rank-boost)
- Valorant: Rank Boost, Win Boost, Placements Boost and Unrated Matches, plus Accounts and VP top-up. — [GameBoost Valorant](https://gameboost.com/valorant/boosting/rank-boost)
- TFT: Rank Boost, Win Boost, Placements Boost and Double Up Boost, plus Accounts. — [GameBoost TFT](https://gameboost.com/teamfight-tactics/boosting/rank-boost)

**Eloking**
- LoL boost types in the configurator: Division Boost, Ranked Wins, Arena, Hire a Teammate, Placements, Normal Games and Coaching. There is also a "Free LoL Boost" page. — [Eloking LoL](https://www.eloking.com/lol-boost)
- The Hire a Teammate and Coaching configurators have Session (Individual/Team), Hours (1–10), Game Mode (Summoner's Rift, ARAM, Featured) and Role inputs. — [Eloking LoL](https://www.eloking.com/lol-boost)

**Skycoach** (LoL catalogue)
- LoL: Accounts, RP, Elo/Division Boost, Placement Matches, Win Boost, Coaching, Mastery Boost, Account Leveling, a battle pass boost ("For Demacia"), Items and Custom order. — [Skycoach LoL](https://skycoach.gg/lol-boost)
- Also LoL Classic (Accounts, Ranked, Placements, Leveling) and Wild Rift (Rank Boost, Legendary Queue Boost, Coaching, Smurf Accounts). — [Skycoach LoL](https://skycoach.gg/lol-boost)
- Skycoach shows "from" prices on catalogue tiles, but the fetched text was garbled (e.g. "080€"), so the values are not reliable.

**BoostRoyal**
- LoL: Pro Divisions, Pro Games (duo), Pro Wins, Placements, Accounts and Smurfs. Champion mastery boosting is mentioned only in a customer review. — [BoostRoyal home](https://www.boostroyal.com/)
- Valorant: Pro Ranks, Pro Games, Pro Wins, Placements, Girl Duo and Coaching. — [BoostRoyal home](https://www.boostroyal.com/)
- TFT: Divisions, Double Up, Set Pass, Ranked Wins, Placements and Coaching. — [BoostRoyal home](https://www.boostroyal.com/)

**GGBoost**
- LoL: Division Boost, Placements, Net Wins, Games, Normal Wins and Account Leveling. The same set is offered for LoL Classic. — [GGBoost](https://ggboost.com/)
- Valorant: Rank Boost, Placements, Net Wins, Duo Games and Unrated Wins. — [GGBoost](https://ggboost.com/)
- TFT: Division Boost, Double Up, Placements, Net Wins and Normal Wins. — [GGBoost](https://ggboost.com/)

**Boosteria**
- LoL: Division Boosting, League Classic Boost, Master+ LP Boosting (current LP 0/350/700/1350 to desired 50/400/750/1400), Coaching (1–5 hours) and Placement Games (1–5 games, priced from previous season rank). — [Boosteria prices](https://boosteria.org/elo-boost/prices)

**Net wins**
- Eloking: "each loss is offset with 2 extra wins", so the customer always receives the exact number of net wins bought. — [Eloking Wins](https://eloking.com/lol-boost/wins)
- GGBoost sells "Net Wins" by that name. — [GGBoost](https://ggboost.com/)

### Inferences
- Common to essentially all sites: rank/division boost, placements and net wins.
- Very common: coaching, normal or unrated wins, and duo play (sold either as a mode or as "Games/Duo Games").
- Present at some sites:
  - Account leveling and account sales (Skycoach, GGBoost, GameBoost)
  - Arena (GameBoost, Eloking)
  - Mastery (GameBoost, Skycoach)
  - TFT Double Up (GameBoost, GGBoost, BoostRoyal)
- Present at only one or two sites, and therefore possible gaps to consider:
  - Master+ LP boosting (Boosteria)
  - Hourly "hire a teammate" or duo sessions (Eloking), and "per game" duo games (BoostRoyal, GGBoost)
  - Valorant unrated wins (GGBoost, GameBoost)
  - TFT Set Pass / LoL battle pass boosting (BoostRoyal, Skycoach)
  - LoL Classic and Wild Rift catalogues
  - A "custom order" option (Skycoach)
  - Girl Duo, a female duo partner (BoostRoyal)
- Only Eloking exposes a Flex queue option.

### Gaps
- Could not verify Overgear, BoostingFactory, LoLBoost.net or EloBoost.net catalogues because the pages did not load.
- Found no dedicated "Valorant agent mastery" product.
- Found no confirmed "coaching per VOD review" pricing.

## 2. Which checkout add-ons exist and how are they priced?

### Takeaway
Add-ons are almost always percentage surcharges on the base price:
- Priority/express: +20–25%
- Stream games: +15–20%
- Solo-only queue: +20% in LoL, +60% in Valorant
- Coaching during the boost: +15–50%
- Choosing a specific booster: +10%
- Duo: about +80% at Boosteria, but advertised as free by Eloking

Champion, agent and role selection is usually free. Offline mode and VPN are increasingly bundled for free as trust features rather than sold. Cashback (3–8%) and loyalty discounts are standard.

### Cited Findings
**GameBoost, LoL rank boost**

| Add-on | Price |
|---|---|
| Priority Boost Completion | +25% |
| Premium Coaching | +15% |
| Stream Games | +15% |
| Champions and Roles Selection | Free |
| Your Champions and Roles | Free |
| Solo Only Queue | +20% |
| Hidden Duo | +25% |
| Challenger Booster | Auto |
| +1 Bonus Win | Auto |

- Checkout also has a discount code field, "spend more get % off", and 3% cashback in coins.
- Source: [GameBoost LoL](https://gameboost.com/league-of-legends/boosting/rank-boost)

**GameBoost, Valorant rank boost**

| Add-on | Price |
|---|---|
| Priority Boost Completion | +25% |
| Premium Coaching | +25% |
| Stream Games | +20% |
| Solo Only Queue | +60% |
| Agents Selection | Free |
| Your Agents | Free |
| +1 Bonus Win | Auto |

- Source: [GameBoost Valorant](https://gameboost.com/valorant/boosting/rank-boost)

**GameBoost, TFT rank boost**

| Add-on | Price |
|---|---|
| Premium Coaching | +50% |
| Stream Games | +15% |
| Priority Boost Completion | +20% |
| +1 Bonus Win | Not shown |

- Source: [GameBoost TFT](https://gameboost.com/teamfight-tactics/boosting/rank-boost)

**Boosteria, LoL division boost**

| Add-on | Price | Notes |
|---|---|---|
| Duo Boost | +80% | |
| Select Booster | +10% | |
| Turbo Boost | +20% | Priority queue; completion "about 20%" faster |
| Choose Champions | Free | |
| Streaming | +15% | Shown via a private link |

- Discounts: loyalty up to 40%, an extra 3% off over $100 and 5% over $200, and a promo code.
- Boosters appear offline by default.
- Source: [Boosteria prices](https://boosteria.org/elo-boost/prices)
- The fetch tool noted that it had to infer which percentage belongs to which add-on, so these mappings are unverified.

**Eloking**
- Duo is "included free". Eloking's FAQ claims competitors charge "50%+" for duo. — [Eloking Divisions](https://eloking.com/lol-boost/divisions)
- Champion, role and summoner spell preferences are free. — [Eloking Wins](https://eloking.com/lol-boost/wins)
- Bulk discount for 10+ wins (amount not stated). — [Eloking Wins](https://eloking.com/lol-boost/wins)
- VPN protection and offline mode are claimed as standard. — [Eloking Wins](https://eloking.com/lol-boost/wins)
- Loyalty program:
  - Cashback of 3%/5%/7% and discounts of 5%/10%/15% by tier
  - Friend referral discount
  - Time-limited 15% first-purchase pop-up
  - Free daily lootbox, advertised to award free boosts, 5–40% discounts, free win upgrades, coaching sessions and duo carries
  - Sources: [Eloking LoL](https://www.eloking.com/lol-boost); [Eloking search snippet/llms.txt](https://eloking.com/llms.txt)

**BoostRoyal**
- Streaming, priority completion, champion requests and specific roles are offered at checkout, but no prices were shown. — [BoostRoyal home](https://www.boostroyal.com/)
- "Strict Offline Mode" is free on every order. — [BoostRoyal home](https://www.boostroyal.com/)
- Duo usually costs more than solo. — [BoostRoyal home](https://www.boostroyal.com/)
- Cashback wallet by 12-month activity: Bronze 3%, Gold 5%, Diamond 6%, Challenger 8%. — [BoostRoyal home](https://www.boostroyal.com/)

**GGBoost**
- Extras named: Express, Streaming, Voice (voice chat with the booster in duo) and Solo Only, "and more". No prices were shown. — [GGBoost](https://ggboost.com/)

**Skycoach**
- Cashback program of "up to 20%". — [Skycoach LoL](https://skycoach.gg/lol-boost)

**Third-party guides**
- Affiliate-style guides treat offline mode and VPN as baseline expectations. — [nerdbot 2026](https://nerdbot.com/2026/05/22/league-of-legends-boost-what-it-actually-is-and-whether-its-worth-it-in-2026/); [tapin.gg](https://tapin.gg/blogs/elo-boosting-alternatives-league-of-legends) (low-reliability, vendor-adjacent sources)

### Inferences
- Paid percentage extras with the most cross-site support:
  - Priority/express (GameBoost, Boosteria, BoostRoyal, GGBoost)
  - Stream games (GameBoost, Boosteria, BoostRoyal, GGBoost)
  - Solo-only/no-duo (GameBoost, GGBoost)
  - Coaching during the boost (GameBoost)
- Distinctive extras worth considering:
  - "Hidden Duo" (+25%, GameBoost)
  - "Select specific booster" (+10%, Boosteria)
  - "Voice" comms (GGBoost)
  - Free "+1 Bonus Win" (GameBoost)
  - Auto-assigned "Challenger Booster" (GameBoost)
  - Loss-compensating net wins (Eloking)
- Offline mode and VPN are now generally free trust signals, not upsells. Charging for them would look out of step with competitors.
- Low-LP-gain handling is done through an LP-gain input in the price calculation (see section 3), not as a separate add-on.

### Gaps
- No live checkout prices for extras at Eloking, Skycoach, Overgear or BoostingFactory (pages not loadable or rendered by JavaScript).
- Found no confirmed site offering paid "schedule / time window" selection or a "low LP compensation" guarantee.
- Found no confirmed "+1 free win" beyond GameBoost's "+1 Bonus Win (Auto)".
- Could not confirm whether GameBoost's "+1 Bonus Win" is free or conditional.

## 3. How do configurators work (UX)?

### Takeaway
The standard pattern is:
- Current tier and division, then desired tier and division
- Current LP or RR in 20-point buckets (0–20 … 81–100)
- An LP-gain bracket that adjusts the price
- Server or region
- Queue (Solo/Duo or Flex)
- Solo or duo mode
- Add-on toggles shown as "+X%"
- Discount code field
- Live total with cashback shown

### Cited Findings
**GameBoost LoL**
- Tier pickers cover Iron to Master with divisions IV to I.
- Current LP is chosen in buckets: 0–20, 21–40, 41–60, 61–80, 81–100.
- LP gain options: Very Low (1–15), Low (16–19), Normal (+20).
- Server list has 17 entries, including PBE.
- Queue: Ranked Solo/Duo or Flex. Mode: Solo or Duo.
- Source: [GameBoost LoL](https://gameboost.com/league-of-legends/boosting/rank-boost)

**GameBoost Valorant**
- Tiers Iron to Immortal with divisions 1–3, RR in 20-point buckets, 5 servers (NA, EU, AP, BR, LATAM) and Solo/Duo mode. — [GameBoost Valorant](https://gameboost.com/valorant/boosting/rank-boost)

**Boosteria**
- LP-gain brackets are 10–19, 20–24, 25–29 and 30+, which differ from GameBoost's brackets.
- Current LP buckets top out at 81–99.
- The Master+ LP product uses LP checkpoint values instead of divisions.
- Source: [Boosteria prices](https://boosteria.org/elo-boost/prices)

**Eloking**
- One unified configurator with a "Boost Type" switch: Division Boost, Ranked Wins, Arena, Teammate, Placements, Normal Games, Coaching.
- Fields change by type: Desired Wins, Region (16 entries), Queue (Solo/Duo, Flex), Game Mode, Role, Hours, Session.
- Source: [Eloking Divisions](https://eloking.com/lol-boost/divisions)
- The Desired Wins limit conflicts between the configurator (1–5) and the FAQ (1–20). — [Eloking Wins](https://eloking.com/lol-boost/wins)

**Trust and urgency elements around the configurator**
- Eloking:
  - "<30 minute starting time" badge
  - "Last Order – 6 hours ago" social proof
  - Booster win-rate claims (90%+ below Diamond)
  - Source: [Eloking Wins](https://eloking.com/lol-boost/wins)
- Boosteria:
  - "Offers for Today Left: 5" counter and a 51% promo banner — [Boosteria home](https://boosteria.org/)
  - "Average start about 5 minutes" — [Boosteria prices](https://boosteria.org/elo-boost/prices)
- Eloking also lists "from" prices per tier jump (e.g. Iron to Bronze "from 22.96", Diamond to Master "from 346.10"; currency not given). — [Eloking LoL](https://www.eloking.com/lol-boost)

### Inferences
- An LP-gain input that changes the price is a near-standard way to price low-gain accounts.
- Separating Solo/Duo from Flex queue, and offering Master+ LP products, extends coverage above Diamond and Master.
- A single configurator with a type switch (Eloking) is an alternative to separate pages per service.

### Gaps
- Could not observe live price recalculation or discount badges directly; the fetched text showed totals of €0.00 or blank.
- Could not verify Skycoach, Overgear or BoostingFactory configurator UX.

## 4. Do sites show estimated completion time, and how?

### Takeaway
Yes. Some sites show a per-order ETA in the configurator: GameBoost shows "1 day" and Boosteria "2 days 15 hours". Others give only generic FAQ ranges plus a "starts within X minutes" badge. No site disclosed its formula, but the ETA appears to scale with the rank distance, and priority/turbo options are sold as reducing it.

### Cited Findings
- GameBoost's checkout shows a duration (e.g. "1 day" for Silver I to Gold IV) and says it depends on the target rank. — [GameBoost LoL](https://gameboost.com/league-of-legends/boosting/rank-boost)
- GameBoost's Valorant FAQ says rank boosts usually take 1–2 days. — [GameBoost Valorant](https://gameboost.com/valorant/boosting/rank-boost)
- Boosteria's configurator shows an example ETA of "2 days 15 hours". It also states:
  - Typical pace: 1–2 divisions per day below Emerald
  - Turbo cuts completion time by about 20%
  - Average start: about 5 minutes
  - Source: [Boosteria prices](https://boosteria.org/elo-boost/prices)
- Eloking's calculator shows no ETA; it shows a "<30 min start" badge instead. Its FAQ ranges are:
  - Gold to Diamond: 2–4 days
  - Diamond to Master: 3–7 days, at about 8–10 games per day
  - Sources: [Eloking Wins](https://eloking.com/lol-boost/wins); [Eloking LoL](https://www.eloking.com/lol-boost)
- BoostRoyal says most orders finish in 1–2 days. — [BoostRoyal home](https://www.boostroyal.com/)

### Inferences
- Showing a configurator ETA that updates with the rank range and priority add-on, plus a "start time" badge, matches the leading UX (GameBoost, Boosteria).
- A likely internal model is games-per-division × games-per-day, consistent with Eloking's "8–10 games per day" and Boosteria's "1–2 divisions/day". This is not confirmed by any site.

### Gaps
- No site documents its ETA formula.
- Found no site that offers a guaranteed deadline with a refund for late delivery.
