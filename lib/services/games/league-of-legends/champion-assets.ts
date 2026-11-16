/**
 * Champion artwork from Riot's official Data Dragon CDN (public, no API key).
 * Data Dragon square icons are keyed by the champion "id" used in Match-V5
 * `championName` (e.g. "MonkeyKing", "KaiSa").
 */

const CATALOG_TO_DDRAGON: Record<string, string> = {
  kaihasa: "Kaisa",
  "lee-sin": "LeeSin",
  "master-yi": "MasterYi",
};

/** Map a catalog champion id ("lee-sin") or display name to a DDragon id. */
export function toDdragonChampionId(idOrName: string): string {
  if (CATALOG_TO_DDRAGON[idOrName]) return CATALOG_TO_DDRAGON[idOrName];
  return idOrName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function championIconUrl(version: string | null, ddragonId: string): string | null {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Za-z0-9]+$/.test(ddragonId)) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${ddragonId}.png`;
}

/** Latest Data Dragon version; cached for a day by Next's fetch cache. */
export async function getDdragonVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const versions = (await res.json()) as unknown;
    return Array.isArray(versions) && typeof versions[0] === "string" ? versions[0] : null;
  } catch {
    return null;
  }
}

export type DdragonChampionMap = Record<number, { id: string; name: string }>;

/**
 * Parse Data Dragon champion.json: `data` is keyed by image id, and each
 * entry's `key` is the numeric championId as a string (verified 16.22.1:
 * {"id":"MonkeyKing","key":"62","name":"Wukong"}). Invalid entries are skipped.
 */
export function parseDdragonChampions(json: unknown): DdragonChampionMap {
  const out: DdragonChampionMap = {};
  const data = (json as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") return out;
  for (const entry of Object.values(data as Record<string, unknown>)) {
    const e = entry as { id?: unknown; key?: unknown; name?: unknown };
    const key = Number(e.key);
    if (typeof e.id === "string" && /^[A-Za-z0-9]+$/.test(e.id) && Number.isInteger(key) && key > 0) {
      out[key] = { id: e.id, name: typeof e.name === "string" ? e.name : e.id };
    }
  }
  return out;
}

/** championId -> Data Dragon id/name for a version; cached for a day. */
export async function getDdragonChampionMap(version: string | null): Promise<DdragonChampionMap | null> {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  try {
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    return parseDdragonChampions(await res.json());
  } catch {
    return null;
  }
}

/**
 * Icon + display name for a match participant. championId is authoritative;
 * the Match-V5 championName string (which can differ from Data Dragon ids,
 * e.g. "FiddleSticks") is only a fallback.
 */
export function resolveMatchChampion(
  version: string | null,
  champions: DdragonChampionMap | null,
  championId: number,
  championName: string
): { name: string; icon: string | null } {
  const hit = champions?.[championId];
  if (hit) return { name: hit.name, icon: championIconUrl(version, hit.id) };
  const fallbackId = championName.replace(/[^A-Za-z0-9]/g, "");
  return { name: championName || `Champion ${championId}`, icon: fallbackId ? championIconUrl(version, fallbackId) : null };
}
