/**
 * VPN extra: the country the booster's VPN must be set to (client PDF
 * "Booster fixes and additions", 2026-11-23). The customer picks it at
 * checkout from every country (searchable, no default: client decision the
 * same day); it is saved with the order's extra choices
 * (championsRoles.vpnCountry) and shown to the booster before and after
 * claiming. Names come from the browser in the visitor's language.
 * Safe for client and server code.
 */

/** Every ISO 3166-1 alpha-2 country and territory code. */
export const VPN_COUNTRIES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;
export type VpnCountry = (typeof VPN_COUNTRIES)[number];

const CODES = new Set<string>(VPN_COUNTRIES);

export function isVpnCountry(v: unknown): v is VpnCountry {
  return typeof v === "string" && CODES.has(v);
}

/** "Germany" (or "Allemagne", "ألمانيا"...) for a country code; the code itself as a fallback. */
export function vpnCountryName(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country with its name in `locale`, sorted by name (for the picker). */
export function vpnCountryOptions(locale = "en"): { code: VpnCountry; name: string }[] {
  return VPN_COUNTRIES.map((code) => ({ code, name: vpnCountryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Case- and accent-insensitive match on the name or the code ("alle" finds "Allemagne"). */
export function matchesCountry(option: { code: string; name: string }, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = fold(query.trim());
  return !q || fold(option.name).includes(q) || option.code.toLowerCase() === q;
}
