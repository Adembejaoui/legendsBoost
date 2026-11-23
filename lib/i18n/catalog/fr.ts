/**
 * French for the catalog data (games, services, order form, FAQs), keyed by
 * the English text. A text missing here shows in English;
 * __tests__/i18n/catalog.test.ts lists any catalog text without a French entry.
 */
export const catalogFr: Record<string, string> = {
  // Games
  "Ranked support for every stage of your climb.": "Un accompagnement classé à chaque étape de votre ascension.",
  "Explore League of Legends services built around the ranked ladder. Every offer is configured per game and reviewed for eligibility before publication.":
    "Découvrez les services League of Legends pensés pour le classement. Chaque offre est configurée par jeu et vérifiée avant sa mise en ligne.",
  "Eligibility under review": "Éligibilité en cours de vérification",
  "Sharpen your edge across the competitive ladder.": "Prenez l'avantage sur tout le classement compétitif.",
  "Explore VALORANT services built around the competitive ladder. Every offer is configured per game and reviewed for eligibility before publication.":
    "Découvrez les services VALORANT pensés pour le mode compétitif. Chaque offre est configurée par jeu et vérifiée avant sa mise en ligne.",
  "Make smarter plays and reach your next tier.": "Jouez plus malin et atteignez le palier suivant.",
  "Explore Teamfight Tactics services for Ranked and Double Up. Every offer is configured per game and reviewed for eligibility before publication.":
    "Découvrez les services Teamfight Tactics en Classé et en Double Up. Chaque offre est configurée par jeu et vérifiée avant sa mise en ligne.",
  "Eligible services are being reviewed for publication.": "Les services éligibles sont en cours de vérification.",
  "Coming soon": "Bientôt",
  "A focused service catalog is in preparation.": "Un catalogue de services ciblé est en préparation.",
  "Services will appear after eligibility review.": "Les services apparaîtront après vérification.",

  // Services
  "Rank Boost": "Rank Boost",
  "Play from your current rank to a target rank on the competitive ladder. Tier and division selection depends on the game's rank system.":
    "De votre rang actuel jusqu'au rang visé. Le choix des paliers et divisions dépend du système de classement du jeu.",
  "Win Boost": "Win Boost",
  "A set number of wins. Available options depend on the game-specific configuration.":
    "Un nombre de victoires défini. Les options dépendent de la configuration du jeu.",
  "Placement Boost": "Placement Boost",
  "Placement matches played at the start of a ranked season or after a rank reset. Quantity depends on the game-specific configuration.":
    "Matchs de placement joués en début de saison ou après une réinitialisation. La quantité dépend de la configuration du jeu.",
  "Arena Boost": "Arena Boost",
  "Arena mode wins. This service does not use a ranked ladder; its fields are defined by the Arena offer configuration.":
    "Victoires en mode Arena. Ce service n'utilise pas de classement ; ses champs viennent de la configuration Arena.",
  "Normal Matches": "Parties normales",
  "Normal (unranked) matches played with optional game-mode preferences.": "Parties normales (non classées), avec vos modes de jeu préférés en option.",
  "Champion Mastery": "Maîtrise de champion",
  "Mastery progress on a specific champion. Champion options come from a configurable champion data source.":
    "Progression de maîtrise sur un champion précis. La liste des champions vient d'une source configurable.",
  "Unrated Matches": "Parties non classées",
  "Unrated matches played with optional preferences when configured.": "Parties non classées, avec vos préférences en option.",
  "Double Up Boost": "Double Up Boost",
  "Climb the TFT Double Up ladder with current rank and target rank selection. Divisions are handled dynamically.":
    "Grimpez le classement Double Up de TFT en choisissant votre rang actuel et le rang visé. Les divisions s'adaptent automatiquement.",
  "Play from your current League of Legends rank to a target rank. Tiers and divisions follow the LoL ranked system.":
    "De votre rang League of Legends actuel jusqu'au rang visé. Paliers et divisions suivent le classement de LoL.",
  "Available": "Disponible",
  "A set number of ranked wins on League of Legends.": "Un nombre défini de victoires classées sur League of Legends.",
  "Placement matches at the start of a ranked season.": "Matchs de placement en début de saison classée.",
  "Arena mode wins on League of Legends, on your account or together with a pro.":
    "Victoires en Arena sur League of Legends, sur votre compte ou avec un pro.",
  "Normal (unranked) matches on League of Legends with optional game-mode preferences.":
    "Parties normales (non classées) sur League of Legends, avec vos modes de jeu préférés en option.",
  "Mastery progress on a specific League of Legends champion.": "Progression de maîtrise sur un champion League of Legends précis.",
  "Play from your current VALORANT competitive rank to a target rank. Tiers follow the VALORANT competitive system.":
    "De votre rang compétitif VALORANT actuel jusqu'au rang visé. Les paliers suivent le mode compétitif de VALORANT.",
  "A set number of competitive wins on VALORANT.": "Un nombre défini de victoires en compétitif sur VALORANT.",
  "Competitive placement matches on VALORANT.": "Matchs de placement en compétitif sur VALORANT.",
  "Unrated matches on VALORANT.": "Parties non classées sur VALORANT.",
  "Play from your current TFT rank to a target rank. Tiers and divisions follow the TFT ranked system.":
    "De votre rang TFT actuel jusqu'au rang visé. Paliers et divisions suivent le classement de TFT.",
  "A set number of wins on Teamfight Tactics.": "Un nombre défini de victoires sur Teamfight Tactics.",
  "Placement matches on Teamfight Tactics.": "Matchs de placement sur Teamfight Tactics.",
  "Climb the TFT Double Up ladder from your current rank to a target rank. Divisions are handled dynamically.":
    "Grimpez le classement Double Up de TFT de votre rang actuel jusqu'au rang visé. Les divisions s'adaptent automatiquement.",

  // Order form
  "Current rank": "Rang actuel",
  "Current Rank": "Rang actuel",
  "Your rank before the boost starts.": "Votre rang avant le début du boost.",
  "Target rank": "Rang visé",
  "The rank you want to reach.": "Le rang que vous voulez atteindre.",
  "Current LP": "LP actuels",
  "Your LP in your current division. More LP means fewer games, so a lower price.":
    "Vos LP dans votre division actuelle. Plus de LP = moins de parties, donc un prix plus bas.",
  "0-20 LP": "0-20 LP",
  "21-40 LP": "21-40 LP",
  "41-60 LP": "41-60 LP",
  "61-80 LP": "61-80 LP",
  "81-100 LP": "81-100 LP",
  "LP Gain": "Gain de LP",
  "How much LP you gain for a win. Low gains need more games.": "Combien de LP vous gagnez par victoire. Des gains faibles demandent plus de parties.",
  "Normal (18-24 LP)": "Normal (18-24 LP)",
  "Low (under 18 LP)": "Faible (moins de 18 LP)",
  "High (25+ LP)": "Élevé (25+ LP)",
  "Current RR": "RR actuels",
  "Your RR in your current division. More RR means fewer games, so a lower price.":
    "Vos RR dans votre division actuelle. Plus de RR = moins de parties, donc un prix plus bas.",
  "0-20 RR": "0-20 RR",
  "21-40 RR": "21-40 RR",
  "41-60 RR": "41-60 RR",
  "61-80 RR": "61-80 RR",
  "81-100 RR": "81-100 RR",
  "RR Gain": "Gain de RR",
  "How much RR you gain for a win. Low gains need more games.": "Combien de RR vous gagnez par victoire. Des gains faibles demandent plus de parties.",
  "Normal (15-22 RR)": "Normal (15-22 RR)",
  "Low (under 15 RR)": "Faible (moins de 15 RR)",
  "High (23+ RR)": "Élevé (23+ RR)",
  "Server": "Serveur",
  "Queue Type": "Type de file",
  "Ranked Solo/Duo": "Classé Solo/Duo",
  "Ranked Flex": "Classé Flex",
  "Number of wins": "Nombre de victoires",
  "How many wins should be played (up to 5 per order).": "Combien de victoires à jouer (jusqu'à 5 par commande).",
  "How many wins should be played.": "Combien de victoires à jouer.",
  "wins": "victoires",
  "Game mode": "Mode de jeu",
  "Preferred queue for the wins.": "File préférée pour les victoires.",
  "Your rank before placements, if known.": "Votre rang avant les placements, si vous le connaissez.",
  "Placement matches remaining": "Matchs de placement restants",
  "How many placement matches are left on your account (up to 5 per order).":
    "Combien de matchs de placement il reste sur votre compte (jusqu'à 5 par commande).",
  "How many placement matches are left on your account.": "Combien de matchs de placement il reste sur votre compte.",
  "matches": "parties",
  "Select your current Arena rank.": "Choisissez votre rang Arena actuel.",
  "Win Amounts": "Nombre de victoires",
  "Select your desired amount of wins.": "Choisissez le nombre de victoires voulu.",
  "Number of matches": "Nombre de parties",
  "How many normal matches should be played.": "Combien de parties normales à jouer.",
  "How many unrated matches should be played.": "Combien de parties non classées à jouer.",
  "Game modes": "Modes de jeu",
  "Preferred normal game modes.": "Modes de jeu normaux préférés.",
  "Blind Pick": "Blind Pick",
  "Draft Pick": "Draft Pick",
  "ARAM": "ARAM",
  "Desired Champion": "Champion voulu",
  "Select the champion you want.": "Choisissez le champion voulu.",
  "Current Mastery": "Maîtrise actuelle",
  "Mastery Level": "Niveau de maîtrise",
  "Level {n}": "Niveau {n}",
  "Desired Mastery": "Maîtrise voulue",

  // Servers
  "North America": "Amérique du Nord",
  "Brazil": "Brésil",
  "Latin America North": "Amérique latine Nord",
  "Latin America South": "Amérique latine Sud",
  "Europe West": "Europe Ouest",
  "Europe Nordic & East": "Europe Nord & Est",
  "Türkiye": "Turquie",
  "Russia": "Russie",
  "Korea": "Corée",
  "Japan": "Japon",
  "Oceania": "Océanie",
  "Singapore": "Singapour",
  "Taiwan": "Taïwan",
  "Vietnam": "Viêt Nam",

  // Availability
  "Price coming soon": "Prix bientôt disponible",
  "Under review": "En cours de vérification",
  "Price shown at configuration": "Prix affiché à la configuration",

  // Ranks (names used by the French game clients)
  "Iron": "Fer",
  "Bronze": "Bronze",
  "Silver": "Argent",
  "Gold": "Or",
  "Platinum": "Platine",
  "Emerald": "Émeraude",
  "Diamond": "Diamant",
  "Master": "Maître",
  "Grandmaster": "Grand Maître",
  "Challenger": "Challenger",
  "Wood": "Bois",
  "Gladiator": "Gladiateur",
  "Ascendant": "Ascendant",
  "Immortal": "Immortel",
  "Radiant": "Radiant",

  // Checkout: session types and extras
  "Solo (pro on your account)": "Solo (un pro sur votre compte)",
  "Duo (play with a pro)": "Duo (jouez avec un pro)",
  "Solo": "Solo",
  "Duo": "Duo",
  "Solo Queue Only": "File solo uniquement",
  "Your booster will queue alone for every game on your account.": "Votre booster lancera chaque partie seul sur votre compte.",
  "+1 Bonus Win": "+1 victoire bonus",
  "After reaching your desired rank, your booster will win one extra game.": "Une fois le rang voulu atteint, votre booster gagnera une partie de plus.",
  "After you reach your desired rank, play with your booster for one extra win.": "Une fois le rang voulu atteint, jouez avec votre booster pour une victoire de plus.",
  "Priority Order": "Commande prioritaire",
  "Your order moves ahead of standard orders in the queue for booster pickup.": "Votre commande passe devant les commandes standard dans la file des boosters.",
  "Live Streaming": "Diffusion en direct",
  "Watch your booster play live and pick up tips from their games.": "Regardez votre booster jouer en direct et apprenez de ses parties.",
  "Stream Games": "Diffuser les parties",
  "Specific Champion and Role": "Champion et rôle précis",
  "Choose your preferred champions and role for the boost.": "Choisissez vos champions et votre rôle préférés pour le boost.",
  "VPN": "VPN",
  "Your booster will use a VPN while playing on your account.": "Votre booster utilisera un VPN en jouant sur votre compte.",
  "Appear Offline": "Apparaître hors ligne",
  "You will appear offline to friends while your booster plays.": "Vous apparaîtrez hors ligne pour vos amis pendant que votre booster joue.",
  "Undercover Winrate": "Winrate discret",
  "Your booster will keep the win rate for your order at 65% or lower.": "Votre booster gardera le taux de victoire de votre commande à 65 % ou moins.",
  "Your booster will keep the win rate for your Duo order at 65% or lower.": "Votre booster gardera le taux de victoire de votre commande Duo à 65 % ou moins.",
  "Moderate KDA": "KDA modéré",
  "Your booster will maintain an average KDA of 4.5 across your order.": "Votre booster gardera un KDA moyen de 4,5 sur votre commande.",
  "Your booster will maintain an average KDA of 4.5 across your Duo order.": "Votre booster gardera un KDA moyen de 4,5 sur votre commande Duo.",
  "OTP Champ Only": "OTP un seul champion",
  "Choose one champion. Your booster will play only that champion for your order.": "Choisissez un champion. Votre booster ne jouera que ce champion pour votre commande.",
  "Voice Chat": "Chat vocal",
  "Talk with your booster during your games.": "Parlez avec votre booster pendant vos parties.",
  "Hidden Duo": "Duo caché",
  "Your booster will switch to a different account every 2 to 3 games.": "Votre booster changera de compte toutes les 2 à 3 parties.",
  "Your Champions and Roles": "Vos champions et rôles",
  "Choose the champions and roles you and your booster will play.": "Choisissez les champions et rôles que vous et votre booster jouerez.",
  "Priority session scheduling": "Planification prioritaire des sessions",
  "Live stream": "Diffusion en direct",
  "Agent selection": "Choix de l'agent",
  "Role or playstyle focus": "Focus rôle ou style de jeu",
  "Aim training review": "Analyse de l'entraînement à la visée",
  "VOD analysis": "Analyse de VOD",
  "Additional coaching time": "Temps de coaching supplémentaire",
  "Post-session performance report": "Rapport de performance après la session",
  "Composition review": "Analyse des compositions",
  "Economy and leveling analysis": "Analyse de l'économie et des niveaux",
  "Augment decision review": "Analyse des choix d'augments",
  "Positioning analysis": "Analyse du placement",
  "Replay analysis": "Analyse des replays",

  // Game FAQs
  "What League of Legends services are offered?": "Quels services League of Legends proposez-vous ?",
  "What VALORANT services are offered?": "Quels services VALORANT proposez-vous ?",
  "What TFT services are offered?": "Quels services TFT proposez-vous ?",
  "Coaching sessions review your recent gameplay and give you a focused improvement plan. Account-sharing boosting and queue/rank manipulation are not offered unless their compliance with Riot Games current rules has been reviewed and approved.":
    "Les séances de coaching analysent vos parties récentes et vous donnent un plan de progression ciblé. Le boosting avec partage de compte et la manipulation de file ou de rang ne sont proposés que si leur conformité aux règles actuelles de Riot Games a été vérifiée et approuvée.",
  "Coaching sessions review your recent lobbies and give you a focused improvement plan. Account-sharing boosting and queue/rank manipulation are not offered unless their compliance with Riot Games current rules has been reviewed and approved.":
    "Les séances de coaching analysent vos lobbies récents et vous donnent un plan de progression ciblé. Le boosting avec partage de compte et la manipulation de file ou de rang ne sont proposés que si leur conformité aux règles actuelles de Riot Games a été vérifiée et approuvée.",
  "Do you need my account password?": "Avez-vous besoin du mot de passe de mon compte ?",
  "No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.":
    "Non. Le coaching se fait par partage d'écran et vocal. Nous ne demandons ni ne conservons jamais les mots de passe de vos comptes de jeu.",
  "When will services become available?": "Quand les services seront-ils disponibles ?",
  "Services are reviewed for eligibility before publication. Only approved services appear as purchasable. Check back as the catalog grows.":
    "Les services sont vérifiés avant leur mise en ligne. Seuls les services approuvés peuvent être achetés. Revenez au fil de l'évolution du catalogue.",

  // Service FAQs
  "How does a Rank Boost work?": "Comment fonctionne un Rank Boost ?",
  "Choose your current and desired rank, your server and the extras you want, then pay. A verified booster takes your order and plays until your desired rank is reached. In Solo the booster plays on your account; in Duo you play together with the booster.":
    "Choisissez votre rang actuel et le rang voulu, votre serveur et les options souhaitées, puis payez. Un booster vérifié prend votre commande et joue jusqu'à atteindre le rang voulu. En Solo, le booster joue sur votre compte ; en Duo, vous jouez avec lui.",
  "How long does it take?": "Combien de temps cela prend-il ?",
  "It depends on how many divisions you buy and your LP gains. Most orders start within an hour of payment. Priority Order moves yours ahead of standard orders. Your booster posts your current rank after every session, so you can follow the progress on your order page.":
    "Cela dépend du nombre de divisions achetées et de vos gains de LP. La plupart des commandes démarrent dans l'heure qui suit le paiement. La commande prioritaire passe la vôtre devant les commandes standard. Votre booster publie votre rang après chaque session : vous suivez l'avancement sur la page de votre commande.",
  "Is my account safe?": "Mon compte est-il en sécurité ?",
  "Your login is encrypted and only your booster can see it, during a play session, and every view is logged. You can add VPN and Appear Offline for free. Boosting is against Riot Games' rules, so no service can promise zero risk, but our boosters play carefully to keep it low.":
    "Vos identifiants sont chiffrés et seul votre booster peut les voir, pendant une session de jeu, et chaque consultation est enregistrée. Vous pouvez ajouter VPN et Apparaître hors ligne gratuitement. Le boosting est contraire aux règles de Riot Games : aucun service ne peut promettre un risque nul, mais nos boosters jouent prudemment pour le limiter.",
  "Can I play on my account during the boost?": "Puis-je jouer sur mon compte pendant le boost ?",
  "Yes. Pause the order from your order page whenever you want to play, then resume it when you are done. Please do not play ranked games while your booster has a session running.":
    "Oui. Mettez la commande en pause depuis sa page quand vous voulez jouer, puis reprenez-la quand vous avez fini. Ne jouez pas de parties classées pendant qu'une session de votre booster est en cours.",
  "What if I am not happy with the result?": "Et si je ne suis pas satisfait du résultat ?",
  "When your booster finishes, the screenshots of the final rank appear on your order page and our team checks them before marking the order Completed. If something is wrong, report a problem and our team will review it.":
    "Quand votre booster a terminé, les captures du rang final apparaissent sur la page de votre commande et notre équipe les vérifie avant de la marquer Terminée. En cas de souci, signalez un problème et notre équipe l'examinera.",
  "What is an Arena Boost?": "Qu'est-ce qu'un Arena Boost ?",
  "You choose how many Arena wins you want (1 to 5) and your server. A booster wins those games for you on your account (Solo), or plays them together with you (Duo).":
    "Vous choisissez le nombre de victoires Arena voulu (1 à 5) et votre serveur. Un booster gagne ces parties pour vous sur votre compte (Solo), ou les joue avec vous (Duo).",
  "How long does an Arena Boost take?": "Combien de temps dure un Arena Boost ?",
  "Arena games are short, so most orders are done within a few hours of the booster starting. Priority moves your order ahead of standard orders.":
    "Les parties Arena sont courtes : la plupart des commandes sont terminées quelques heures après le début. La priorité passe votre commande devant les commandes standard.",
  "Can I choose the champions?": "Puis-je choisir les champions ?",
  "Yes. In Solo, Specific Champion and Role is free, and OTP Champ Only makes the booster play one champion of your choice. In Duo, Your Champions and Roles lets you pick them.":
    "Oui. En Solo, Champion et rôle précis est gratuit, et OTP un seul champion fait jouer au booster le champion de votre choix. En Duo, Vos champions et rôles vous permet de les choisir.",
  "Is my account safe during an Arena Boost?": "Mon compte est-il en sécurité pendant un Arena Boost ?",
  "Your login is encrypted and only visible to your booster during a session. VPN and Appear Offline are free in Solo. As with any boosting service, Riot Games' rules apply and no one can promise zero risk.":
    "Vos identifiants sont chiffrés et visibles seulement par votre booster pendant une session. VPN et Apparaître hors ligne sont gratuits en Solo. Comme pour tout service de boosting, les règles de Riot Games s'appliquent et personne ne peut promettre un risque nul.",
  "What happens when the wins are done?": "Que se passe-t-il une fois les victoires obtenues ?",
  "Your booster completes the order with screenshots, which you see on your order page. Our team checks them and marks the order Completed. If something is wrong, report a problem.":
    "Votre booster termine la commande avec des captures, visibles sur la page de votre commande. Notre équipe les vérifie et marque la commande Terminée. En cas de souci, signalez un problème.",
};
