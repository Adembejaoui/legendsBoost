/**
 * Risk disclosure the customer must accept before paying (stored on the
 * order with this version). Change the text => bump the version, so every
 * order records exactly which wording was accepted.
 *
 * Wording follows the research (reports/Game boosting competitor features.md):
 * no "ban-safe" promises; Riot penalises boosting (including duo).
 */
export const RISK_DISCLOSURE_VERSION = "2026-11-14";

export const RISK_DISCLOSURE_TEXT =
  "I understand that boosting and account sharing break Riot Games' Terms of Service, " +
  "and that Riot may penalise the account (for example a ban, or LP and rank removal). " +
  "LegendsBoost cannot guarantee that this will not happen.";
