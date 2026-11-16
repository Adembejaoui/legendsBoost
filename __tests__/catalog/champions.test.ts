import { describe, expect, it } from "vitest";
import { champions, getChampion, LOL_ROLES, normalizeChampionId } from "@/lib/catalog/champions";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { validateOrderInput } from "@/lib/pricing/order-input";

describe("League of Legends champion catalog", () => {
  it("has every champion (Data Dragon), unique ids, icons and at least one lane", () => {
    expect(champions.length).toBeGreaterThanOrEqual(170);
    expect(new Set(champions.map((c) => c.id)).size).toBe(champions.length);
    for (const c of champions) {
      expect(c.iconSrc).toMatch(/^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/\d+\.\d+\.\d+\/img\/champion\/[A-Za-z0-9]+\.png$/);
      expect(c.lanes?.length).toBeGreaterThan(0);
      for (const l of c.lanes!) expect(LOL_ROLES.map((r) => r.id)).toContain(l);
    }
  });

  it("uses stable ids and Riot's asset ids for special names", () => {
    expect(getChampion("wukong")).toMatchObject({ name: "Wukong", ddragonId: "MonkeyKing" });
    expect(getChampion("kaisa")?.name).toBe("Kai'Sa");
    expect(getChampion("nunu-willump")?.name).toBe("Nunu & Willump");
    expect(getChampion("lee-sin")?.ddragonId).toBe("LeeSin");
  });

  it("keeps ids stored on older orders working", () => {
    expect(normalizeChampionId("kaihasa")).toBe("kaisa");
    expect(getChampion("kaihasa")?.name).toBe("Kai'Sa");
    expect(normalizeChampionId("not-a-champion")).toBeUndefined();
  });
});

describe("champions & roles validation on orders", () => {
  const offer = getGameServiceOffer("league-of-legends", "win-boost")!;
  const checkout = getCheckoutConfig("league-of-legends", "win-boost")!;
  const base = {
    gameSlug: "league-of-legends",
    serviceSlug: "win-boost",
    configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, wins: 2 },
    selectedMode: "solo" as const,
    selectedOptions: ["champions-roles"],
  };

  it("accepts real lanes and champions, normalizes legacy ids and removes duplicates", () => {
    const v = validateOrderInput(offer, checkout, { ...base, championsRoles: { roles: ["jungle", "jungle"], champions: ["kaihasa", "kaisa", "wukong"] } });
    expect(v.ok && v.value.championsRoles).toEqual({ roles: ["jungle"], champions: ["kaisa", "wukong"] });
  });

  it("rejects unknown lanes and champions", () => {
    const v = validateOrderInput(offer, checkout, { ...base, championsRoles: { roles: ["bot-lane"], champions: ["teemo2"] } });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toMatch(/Unknown role: bot-lane.*Unknown champion: teemo2/);
  });
});
