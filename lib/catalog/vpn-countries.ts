/**
 * VPN extra: the country the booster's VPN must be set to (client PDF
 * "Booster fixes and additions", 2026-11-23). The customer picks it at
 * checkout; it is saved with the order's extra choices
 * (championsRoles.vpnCountry) and shown to the booster before and after
 * claiming. Names come from the browser in the visitor's language.
 * Safe for client and server code.
 */
export const VPN_COUNTRIES = [
  "US", "CA", "MX", "BR", "AR", "CL",
  "GB", "IE", "FR", "DE", "NL", "BE", "ES", "IT", "PL", "SE",
  "TR", "AE", "SA", "EG", "MA", "TN",
  "JP", "KR", "SG", "TW", "VN", "AU",
] as const;
export type VpnCountry = (typeof VPN_COUNTRIES)[number];

export function isVpnCountry(v: unknown): v is VpnCountry {
  return typeof v === "string" && (VPN_COUNTRIES as readonly string[]).includes(v);
}

/** Suggested country for an order's server (Riot platform), so most customers just confirm it. */
const BY_SERVER: Record<string, VpnCountry> = {
  NA1: "US",
  BR1: "BR",
  LA1: "MX",
  LA2: "CL",
  EUW1: "DE",
  EUN1: "PL",
  TR1: "TR",
  KR: "KR",
  JP1: "JP",
  OC1: "AU",
  SG2: "SG",
  TW2: "TW",
  VN2: "VN",
};

export function defaultVpnCountry(server: unknown): VpnCountry {
  return (typeof server === "string" && BY_SERVER[server]) || "US";
}

/** "Germany" (or "Allemagne", "ألمانيا"...) for a country code; the code itself as a fallback. */
export function vpnCountryName(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
