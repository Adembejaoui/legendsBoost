import { describe, it, expect } from "vitest";
import {
  resolveRiotRouting,
  riotPlatformSchema,
  RIOT_PLATFORMS,
  normalizePlatform,
  getPlatformHost,
  getMatchRegion,
  getAccountCluster,
} from "@/lib/riot/lol/routing";

describe("riot routing", () => {
  it("every platform has valid routing", () => {
    for (const p of RIOT_PLATFORMS) {
      const r = resolveRiotRouting(p);
      expect(r.platform).toBe(p);
      expect(r.platformHost).toBe(`${p.toLowerCase()}.api.riotgames.com`);
      expect(["americas","asia","europe","sea"]).toContain(r.matchRegion);
      expect(["americas","asia","europe"]).toContain(r.accountCluster);
    }
  });
  it("EUW1", () => {
    const r = resolveRiotRouting("EUW1");
    expect(r.platformHost).toBe("euw1.api.riotgames.com");
    expect(r.matchRegion).toBe("europe");
    expect(r.accountCluster).toBe("europe");
  });
  it("EUN1", () => {
    const r = resolveRiotRouting("eun1");
    expect(r.platform).toBe("EUN1");
    expect(r.platformHost).toBe("eun1.api.riotgames.com");
    expect(r.matchRegion).toBe("europe");
  });
  it("NA1", () => {
    const r = resolveRiotRouting("NA1");
    expect(r.platformHost).toBe("na1.api.riotgames.com");
    expect(r.matchRegion).toBe("americas");
    expect(r.accountCluster).toBe("americas");
  });
  it("TR1", () => {
    const r = resolveRiotRouting("TR1");
    expect(r.platformHost).toBe("tr1.api.riotgames.com");
    expect(r.matchRegion).toBe("europe");
  });
  it("Match-V5 uses regional host", () => {
    const r = resolveRiotRouting("NA1");
    expect(r.matchHost).toBe("americas.api.riotgames.com");
    expect(r.matchHost).not.toBe(r.platformHost);
  });
  it("account cluster has no sea", () => {
    for (const p of RIOT_PLATFORMS) {
      expect(getAccountCluster(p)).not.toBe("sea" as any);
    }
  });
  it("case normalization", () => {
    expect(normalizePlatform("euw1")).toBe("EUW1");
    expect(getPlatformHost("NA1")).toBe("na1.api.riotgames.com");
  });
  it("invalid platform rejected", () => {
    expect(() => resolveRiotRouting("EUW")).toThrow();
    expect(() => riotPlatformSchema.parse("foo")).toThrow();
    expect(() => normalizePlatform(123)).toThrow();
  });
  it("missing platform rejected", () => {
    expect(() => resolveRiotRouting(undefined)).toThrow();
    expect(() => resolveRiotRouting(null)).toThrow();
    expect(() => resolveRiotRouting("")).toThrow();
  });
  it("no arbitrary hostname generation", () => {
    expect(() => getPlatformHost("evil.com" as any)).toThrow();
  });
});
