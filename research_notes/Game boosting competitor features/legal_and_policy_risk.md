# Legal, Policy and Platform Risk for Game Boosting Services (LoL, Valorant, TFT), 2025-2026

Not legal advice. Researched November 2026. Many secondary sources are gaming-news sites; primary Riot pages were fetched where possible. Uncertainties and conflicts are flagged inline.

## 1. Riot Terms of Service, enforcement, and penalties for boosted accounts (LoL and Valorant, 2024-2026)

### Takeaway
Riot's ToS flatly bans account sharing, account sale/transfer and "boosting", and since September 2025 (LoL) and 2026 (Valorant) Riot has run a dedicated "Vanguard Anti-Boost" system. It covers account-shared boosting **and** paid duo boosting / "hitchhiking". Penalties include LP/MMR reversion, loss of ranked rewards, escalating bans (3-day, then 14-day, then permanent), bans carried across linked accounts, and permanent bans for purchased accounts. Riot reports 296,416 accounts actioned across both games.

### Cited Findings
**ToS text (effective Dec 1, 2024)**
- Sec. 1.5: "You can't share your account or Login Credentials with anyone" and "You can't sell, transfer or allow any other person to access your account or Login Credentials, or offer to do so." — [Riot ToS](https://www.riotgames.com/en/terms-of-service)
- Sec. 7.1(15), under cheating/anticompetitive behavior, prohibits "playing on another person's account or otherwise engaging in activity intended to 'boost' an account's status or rank." — [Riot ToS](https://www.riotgames.com/en/terms-of-service)
- Sec. 7.1(8) prohibits "circumventing any technological measure implemented by Riot". VPNs are not named. Sec. 9.2 lets Riot require anti-cheat software. Listed sanctions include temporary bans, suspension/termination, hardware bans and progress resets. Sec. 7.3: a violation can be penalized across "certain other or all Riot Services". Sec. 2.3: no refunds after a for-cause termination. — [Riot ToS](https://www.riotgames.com/en/terms-of-service)

**LoL 2025 crackdown (official)**
- Dev post, Aug 11, 2025: boosting is "a more skilled player (the booster) logs into another player's account". It is explicitly against the ToS. Account sharing and selling are "a hard no-go" and "can result in immediate bans". Any account "not leveled and used by a single player" counts as purchased/botted. Riot added a "Rank Manipulation" report category in Patch 25.13, uses Vanguard to detect shared/sold/botted accounts, and began action on boosting and hitchhiking in Patch 25.18. — [LoL Dev: Banning bots, boosters and more in 2025](https://www.leagueoflegends.com/en-us/news/dev/dev-banning-bots-boosters-and-more-in-2025/)
- Account Penalties & Enforcement FAQ, Oct 6, 2025 (Riot Phroxzon):
  - Purchased/botted-account bans and account-sharing punishments start Sept 9, 2025 (Patch 25.18), applied retroactively "as far back as detection allows". For sharing, that covers 2025 onward.
  - Boosting penalties hit **both the boosted account and the booster**: 1st offense 3-day ban, 2nd 14-day, 3rd permanent. All LP/MMR gained by boosting is reverted. Current-season ranked rewards are excluded or revoked. Honor drops to level 1-2.
  - **Duo boosting (a booster queuing with someone on a smurf) counts as boosting.**
  - Sharing tied to ranked manipulation means suspension plus loss of benefits and rewards. One casual normal or TFT game "will likely go unpunished".
  - Purchased accounts "will almost certainly be banned" ("don't buy accounts. This is your final warning").
  - Penalty linking across accounts starts Nov 19, 2025 (Patch 25.23).
  - Detection: "We're not just flagging accounts that share the same IP addresses". Multiple signals are used. Boosting is judged by unusual MMR change over a short period.
  - No exceptions for streamers/pros.
  - Korea uses its own identity verification.
  — [LoL Account Penalties & Enforcement FAQ](https://leagueoflegends.com/en-gb/news/dev/account-penalties-and-enforcement-faq)

**Vanguard Anti-Boost (LoL + Valorant)**
- Riot news post (page dated Sept 17, 2026). Anti-Boost launched privately on LoL in Sept 2025. Valorant adopted it after about a year of beta. Riot reports 296,416 accounts actioned for rank manipulation across both games, with enforcement "not even yet at full power".
  - Covered behavior: account sharing, **paid queueing/duo boosting**, hitchhiking, deranking, and buying low-rated accounts.
  - Penalties: ranked points and rewards revoked plus escalating suspensions. Purchased/ownerless smurfs are banned permanently. Habitual boosters' main accounts also get escalating suspensions. Hitchhikers lose undeserved rank "even if they were unaware".
  - Detection: a classifier flags accounts where a significant share of points comes from a higher-rated player logging in, plus performance anomalies.
  - Future plans: expanded hardware attestation (possible TPM 2.0), more MFA restrictions.
  — [Riot Games: Vanguard Anti-Boost](https://www.riotgames.com/en/news/vanguard-anti-boost)
- Secondary coverage of the ~300k figure: [Sheep Esports](https://www.sheepesports.com/de/articles/nearly-300-000-league-of-legends-and-valorant-accounts-banned-for-rank-manipulation/en); [esports.gg](https://esports.gg/news/esports/riot-vanguard-bans-300000-smurfs/); [Insider Gaming](https://insider-gaming.com/riot-games-valorant-league-rank-manipulation/)
- **Date conflict on the Valorant rollout.** One secondary result describes "Patch 11.09" MFA and boosted-account bans ([GameRiv](https://gameriv.com/purchased-or-boosted-accounts-will-receive-bans-in-valorant-patch-11-09/)). Another search summary placed Valorant's anti-boost in Patch 13.01, July 2026 ([GameRiv](https://gameriv.com/valorant-boosters-are-being-banned-as-vanguard-anti-boost-rolls-out/)). Riot's own post (Sept 2026) says Valorant adopted it after about a year of beta following LoL's Sept 2025 launch. The 2026 timing is most consistent with that; exact patch numbers are unverified.
- Riot also cracked down on Valorant/LoL streamers who promote boosting, smurfing and account buying. Only the headline could be retrieved; date and details are unverified. — [GamesRadar](https://gamesradar.com/games/league-of-legends/riot-games-cracks-down-on-valorant-and-league-of-legends-streamers-who-promote-boosting-smurfing-and-buying-accounts)
- Riot can perma-ban a single account with multiple chargebacks. This matters if customers charge back purchases tied to their Riot account. — [Riot Support: Chargebacks](https://support.riotgames.com/riot/billing/chargebacks)

### Inferences
- "Duo boosting is safe" is no longer a credible claim for LoL or Valorant. Riot explicitly names paid duo / queueing with a booster as boosting, and penalizes the customer's account (LP/MMR reversion, reward loss, bans).
- Account-shared boosting is the highest-risk feature. Detection is multi-signal (MMR anomaly, performance, Vanguard/hardware) rather than IP-only, and retroactive enforcement plus account linking spread the damage to customers' other accounts.
- Account sales are the most severe. Purchased accounts are "almost certainly" banned, and the policy is described as a "final warning".
- Coaching (a coach does not play on or with the account in ranked) is not prohibited in the ToS text reviewed, and is the lowest-risk category. Riot penalizes boosting "disguised as coaching" (see Q2).
- Enforcement is still escalating (TPM/MFA plans), so risk for shared-account products should be assumed to increase through 2026-2027.

### Gaps
- No official TFT-specific boosting penalty ladder was found. The LoL FAQ only says a casual TFT game while sharing "will likely go unpunished", which does not cover TFT ranked boosting.
- The exact Valorant penalty durations and patch numbers were not confirmed from Riot primary sources. One secondary claim of a "90-day penalty" is undated and unverified.
- No Riot statement specifically on "appear offline" modes was found.

## 2. Riot Developer API policy: can a boosting product use the Riot API or get a production key?

### Takeaway
Very unlikely. Riot's API policies require every product to be registered and audited. They forbid products that create unfair advantages or alternatives to ranked, and Riot's 2XKO policy page explicitly gives "a boosting service disguised as coaching/training" as a forbidden monetization. A product that facilitates ToS violations (account sharing, boosting) would conflict with the policy and with Riot's ToS. Using the API without approval risks key revocation.

### Cited Findings
- General Policies (last updated May 29, 2025): "All products must be registered in, and audited by Riot Games through the Developer Portal". "Products cannot create an unfair advantage for players". "Products cannot create alternatives for official skill ranking systems such as the ranked ladder". "Your monetization cannot gouge players or be unfair". Acceptable charging models are listed (subscriptions, donations, crowdfunding, tournament fees, non-fiat currencies). "Don't share your Riot Games account information with anyone". The page does not mention boosting explicitly. — [Riot Developer General Policies](https://developer.riotgames.com/policies/general)
- 2XKO API policy: "They cannot add a boosting service disguised as coaching/training for example." Also: "Products cannot create an unfair advantage", and "Your monetization cannot gouge players or be unfair, as decided by Riot." — [Riot Developer: 2XKO docs/policy](https://developer.riotgames.com/docs/2xko)
- Production-key evaluation weighs whether the use case is "good and approved" and whether the developer will deliver it. If developers are unsure about monetization, Riot says to ask via the Developer Portal. (From search summary; the support page returned 403.) — [Riot Developer Support: API Policy](https://support-developer.riotgames.com/hc/en-us/articles/22698732381587)

### Inferences
- A rank-tracking or order-verification feature in a boosting marketplace (e.g. pulling a customer's rank via the API to price or verify an order) would almost certainly fail Riot's audit. It would also expose the operator's Riot developer account to termination.
- The explicit "boosting disguised as coaching" language means a coaching relabel will not get past a Riot audit if the underlying service is boosting.
- A coaching-only or VOD-review product might be approvable, but this is uncertain and would need direct confirmation from Riot.

### Gaps
- The LoL/Valorant/TFT game-specific policy pages and the support "unapproved use cases" article could not be fetched (403). I found no public record of a boosting site's production key being granted or denied.

## 3. Laws: South Korea's anti-boosting law, other jurisdictions, EU/US consumer protection

### Takeaway
South Korea criminalized paid boosting via a 2018 amendment to the Game Industry Promotion Act (in force 2019): up to 2 years' imprisonment or a fine of up to KRW 20M (about US$18k). No comparable boosting-specific law was found elsewhere. In the EU, boosting/coaching is a **service**. Consumers keep a 14-day withdrawal right unless they expressly request immediate performance, and they lose it only once the service is fully performed (with acknowledgement). Partial performance means a proportionate refund. A 2026 CJEU ruling and the new "withdrawal button" rules tighten this.

### Cited Findings
- **South Korea.** The Game Industry Promotion Act amendment criminalizes services that, for a fee, play others' accounts to raise level or rank. The definition is an "act that interferes with a game's normal operations by providing the service to acquire points or achievements in a way that is not approved by the game business operator". Penalty: up to 2 years in prison or up to KRW 20M. — [Dexerto](https://www.dexerto.com/gaming/game-boosting-is-now-a-crime-in-south-korea-and-those-who-get-caught-could-go-to-jail-263976); [Dot Esports](https://dotesports.com/overwatch/news/south-korean-law-to-punish-boosters-passes-in-the-national-assembly); [Korea Times, Jan 2019 (older)](https://www.koreatimes.co.kr/amp/opinion/20190113/recent-trends-in-gaming-industry-regulations)
- A separate 2026 Korean amendment requires foreign game companies to appoint domestic representatives. It is unrelated to boosting. — [PocketGamer.biz](https://www.pocketgamer.biz/new-south-korean-law-mandates-foreign-game-companies-to-appoint-domestic-representatives)
- Riot uses Korea-specific identity verification for account linking. — [LoL Enforcement FAQ](https://leagueoflegends.com/en-gb/news/dev/account-penalties-and-enforcement-faq)
- **EU Consumer Rights Directive 2011/83.**
  - Art. 16(a): the withdrawal-right exception for services applies only when the service has been fully performed with the consumer's prior consent.
  - Art. 16(m): the digital-content exception requires express consent plus acknowledgement of losing the right, confirmed on a durable medium.
  — [Compliance summary of CRD Arts 9-16](https://compliance-ai-h.pages.dev/regulations/eu/consumer-rights-directive/withdrawal-rights); [EU e-Justice: CRD](https://webgate.ec.europa.eu/e-justice/639/EN/consumer_rights_directive_201183)
- CJEU *Sky Österreich* (C-234/25, 9 July 2026): streaming is a "digital service", not "digital content". Providers cannot use the digital-content waiver to end the 14-day right once streaming starts. Digital services follow the general services rule. — [Covington Inside Privacy](https://www.insideprivacy.com/consumer-protection/cjeu-decides-when-streaming-subscriptions-are-subject-to-the-right-of-withdrawal/); [Matheson](https://www.matheson.com/insights/cjeu-clarifies-withdrawal-rights-for-streaming-subscriptions/)
- Directive (EU) 2023/2673 adds a mandatory online "withdraw from the contract here" button with a confirm step and a durable-medium confirmation. — [Dreyfus (Mar 2026)](https://www.dreyfus.fr/en/2026/03/06/consumer-law-what-are-the-rules-governing-the-three-click-right-of-withdrawal-in-the-european-union/); [Lawwwing](https://lawwwing.com/en/withdrawal-button-subscriptions/)

### Inferences
- Under the CRD, boosting and coaching sessions are best treated as services. EU checkout should:
  - capture the consumer's express request to start within 14 days, plus acknowledgement;
  - handle pro-rata refunds for partially completed orders;
  - provide the withdrawal button.
- "No refunds once the booster starts" terms are likely unenforceable against EU consumers.
- Legally, a contract to perform a service that breaches a third party's ToS (Riot) is generally not itself illegal outside Korea. However, it creates consumer-protection exposure if marketing claims (e.g. "100% safe", "ban-proof") are misleading, given Riot's documented enforcement. This is an inference; no case law was found.
- Operating in or marketing to South Korea, or using Korean boosters on behalf of Korean customers, carries criminal risk.

### Gaps
- I did not locate the Korean statutory text or any reports of court outcomes or prosecutions under the boosting provision.
- I did not confirm the application date of Directive 2023/2673 (widely reported as June 19, 2026, but not verified from a fetched source here).
- I found no US federal or state boosting-specific law. US consumer-protection points (FTC Act Sec. 5 on deceptive claims, state auto-renewal laws, card-network chargeback rights) were not researched with sources.
- No other jurisdiction (China, Japan, etc.) boosting laws were found in this pass.

## 4. Payment-processor risk (Stripe, PayPal) and how competitors take payments

### Takeaway
Neither Stripe's list nor the PayPal results name "boosting" explicitly. However, Stripe restricts sale of in-game items "unless the business is the operator of the virtual world" and has broad catch-alls. PayPal requires pre-approval for virtual in-game items. Services that facilitate a publisher-ToS breach, plus high dispute rates on digital services, make account closure and fund holds a material risk. Account sales are the riskiest line. Competitors reportedly lean on cards via processors plus crypto as a chargeback-proof fallback.

### Cited Findings
- Stripe Restricted Businesses (updated 2026-09-22):
  - **Restricted:** "Sale of in-game currency or game items, unless the business is the operator of the virtual world". Also "Sale of stored value or credits maintained, accepted, and issued by anyone other than the seller".
  - **Prohibited catch-all:** "Any other businesses that Stripe considers unfair, deceptive, or predatory towards consumers".
  - Also prohibited: games of skill such as tournaments with prizes, gambling, and "Sales of online traffic or engagement".
  - "Boosting" and "game accounts" are not explicitly listed.
  — [Stripe Restricted Businesses](https://stripe.com/legal/restricted-businesses)
- PayPal: no clause naming boosting or game accounts was found. A third-party reading of the AUP says businesses accepting PayPal for "virtual in-game items, or any digital representation of value" need pre-approval (secondary, unverified; PayPal's AUP page returned 403). Braintree's AUP restricts virtual currency/credits that can exit the virtual world. — [ConductAtlas on PayPal AUP](https://conductatlas.com/platform/paypal/paypal-acceptable-use-policy/cryptocurrency-pre-approval-requirement/); [Braintree AUP](https://www.paypal.com/legalhub/braintree/acceptable-use-policy); [PayPal AUP](https://www.paypal.com/us/webapps/mpp/ua/acceptableuse-full)
- PayPal Community thread on selling game accounts: replies note publisher rules may apply and that PayPal may request supplier invoices. No authoritative answer. — [PayPal Community](https://www.paypal-community.com/t5/Merchant-Products-and-Services/Am-I-allowed-to-sell-game-accounts-using-Paypal-as-the-payment/td-p/2227605)
- Chargeback thresholds: PayPal may review, restrict or raise reserves above about 1% chargebacks (vendor guide). Stripe merchants above about 0.65-1% are considered high risk. Vendor sources say 180-day holds are typical after high-risk closures. These are vendor/advocacy sources, not Stripe or PayPal docs. — [Solidgate](https://solidgate.com/?p=113127); [chargeback.io](https://www.chargeback.io/fr/blog/stripe-closed-suspended-my-account); [Paysight](https://blog.paysight.io/blog/stripe-terminated-account)
- One boosting seller's blog says most purchases are made by card through a standard processor, with crypto preferred by some buyers. It cites chargeback fees up to $20 per dispute. — [TeamSmurf blog](https://teamsmurf.com/how-to-pay-for-dota-2-boosting-paypal-crypto/)
- Crypto-gateway vendors market themselves to merchants banned by Stripe or PayPal. Their claims are promotional. — [PayRam](https://payram.com/blog/high-risk-merchant-survival-guide-2025-bypass-banking-bans-with-crypto-payments); [Paymento](https://paymento.io/?p=9036)
- Riot's own post jokingly suggests players file chargebacks against boosters. This signals that dispute volume on boosting purchases could rise after bans. — [Riot: Vanguard Anti-Boost](https://www.riotgames.com/en/news/vanguard-anti-boost)

### Inferences
- The main payment risk is chargebacks driven by Riot penalties. A customer whose LP is reverted or account banned may dispute the charge, and higher ban rates since 2025 likely raise dispute ratios. Clear terms, evidence of delivery, and refund policies reduce this.
- Account sales map most directly to Stripe's restricted "game items" category and PayPal's virtual-item pre-approval, so they carry the highest processor risk.
- Coaching is easiest to underwrite as a normal service.
- Crypto avoids chargebacks but adds AML/KYC and consumer-trust issues. It does not remove EU withdrawal obligations.

### Gaps
- No official Stripe or PayPal statement naming boosting was found.
- I found no reliable data on which high-risk processors boosting competitors actually use; those sites' payment pages were not fetched.

## 5. Competitor mitigations (duo-only, coaching framing, "appear offline", VPN claims) and their credibility

### Takeaway
Riot's 2025-2026 policies undercut the common mitigations. Duo boosting is now explicitly treated as boosting. Riot says it does not rely on IP alone, so VPN "same-region/same-IP" claims do little against Vanguard, hardware and MMR-anomaly signals. "Appear offline" only hides the booster from the customer's friends list and does nothing against server-side detection. Riot explicitly calls out boosting "disguised as coaching". Only genuine coaching (the coach does not play ranked on or with the account) is materially lower risk.

### Cited Findings
- Duo boosting / paid queueing is explicitly boosting, with penalties applied to the boosted player and hitchhikers. — [LoL Enforcement FAQ](https://leagueoflegends.com/en-gb/news/dev/account-penalties-and-enforcement-faq); [Riot: Vanguard Anti-Boost](https://www.riotgames.com/en/news/vanguard-anti-boost)
- Detection is multi-factor, not IP-based ("We're not just flagging accounts that share the same IP addresses"). Signals include MMR swings, performance far above the account's level, a classifier on points earned while a higher-rated player is logged in, Vanguard, and planned TPM/hardware attestation and MFA. — [LoL Enforcement FAQ](https://leagueoflegends.com/en-gb/news/dev/account-penalties-and-enforcement-faq); [Riot: Vanguard Anti-Boost](https://www.riotgames.com/en/news/vanguard-anti-boost)
- Circumventing Riot technological measures is a ToS violation in its own right. — [Riot ToS 7.1(8)](https://www.riotgames.com/en/terms-of-service)
- Riot's API policy explicitly names "a boosting service disguised as coaching/training" as unacceptable. — [Riot Developer: 2XKO policy](https://developer.riotgames.com/docs/2xko)
- Playing normals, other modes, or TFT together is allowed. Ranked duo with a paid booster is not. — [LoL Enforcement FAQ](https://leagueoflegends.com/en-gb/news/dev/account-penalties-and-enforcement-faq)
- Riot has run sanctions against creators who promote boosting, smurfing or account buying (headline only). — [GamesRadar](https://gamesradar.com/games/league-of-legends/riot-games-cracks-down-on-valorant-and-league-of-legends-streamers-who-promote-boosting-smurfing-and-buying-accounts)

### Inferences (feature-level risk ranking, highest to lowest)
1. **Account sales.** Purchased accounts are "almost certainly" banned, the line carries the highest processor risk, and it is a ToS sale/transfer breach.
2. **Account-shared boosting**, including "offline mode" and VPN add-ons. Explicit ToS breach, retroactive detection, linked-account penalties, criminal in Korea. VPN and offline add-ons are cosmetic against Riot's stated detection methods.
3. **Duo boosting.** Now explicitly penalized in LoL and Valorant. It is lower risk only in that the customer keeps their credentials. Marketing it as "100% safe" is not credible and may be a misleading claim.
4. **Game streaming / "play via remote desktop or cloud".** Not found addressed in sources. Functionally it is still another person playing the account ("playing on another person's account"), and performance-anomaly detection would still apply. This is inferred, not sourced.
5. **Coaching** (VOD review, live spectating, non-ranked play together). Not prohibited by the reviewed ToS text. It is the defensible core, provided the coach does not play ranked on or with the customer.

### Gaps
- I did not fetch competitor sites' own FAQ claims (VPN, offline, "safe" guarantees), so this section relies on Riot's stated detection methods rather than direct quotes of competitor marketing.
- No sources were found on "game streaming" boosting (Parsec / cloud-play) or Riot's ability to detect it.
- I found no independent data on actual ban rates for duo versus shared-account customers.
