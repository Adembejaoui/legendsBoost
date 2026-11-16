/** League of Legends lanes ("roles") a customer can ask the booster to play. */
export type LolLane = "top" | "jungle" | "mid" | "adc" | "support";

/** One champion as generated from Riot Data Dragon (+ lane data). */
export interface LolChampionData {
  /** Stable URL-safe id stored on orders, e.g. "kaisa", "lee-sin". */
  id: string;
  /** Riot numeric champion key (Match-V5 championId). */
  key: number;
  /** Data Dragon id used in asset URLs, e.g. "Kaisa", "MonkeyKing". */
  ddragonId: string;
  name: string;
  title: string;
  /** Riot class tags: Fighter, Mage, Marksman, Assassin, Tank, Support. */
  tags: string[];
  lanes: LolLane[];
}
