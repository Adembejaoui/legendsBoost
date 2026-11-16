import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  latest: ["EUW1_2"] as string[] | Error,
  dataAccess: true,
}));

vi.mock("@/lib/prisma", () => ({
  default: { orderRiotAccount: { findUnique: vi.fn(async () => h.account) } },
}));
vi.mock("@/lib/services/games/league-of-legends/capabilities", () => ({
  getRiotCapabilities: () => ({ dataAccess: h.dataAccess }),
}));
vi.mock("@/lib/services/games/league-of-legends/shared-client", () => ({ getRiotClient: () => ({}) }));
vi.mock("@/lib/services/games/league-of-legends/sync.service", () => ({
  syncOrderRiotData: vi.fn(async () => ({ status: "synced" })),
}));
vi.mock("@/lib/services/games/league-of-legends/profile.service", async (orig) => {
  const real = await orig<typeof import("@/lib/services/games/league-of-legends/profile.service")>();
  return {
    ...real,
    fetchLatestMatchIds: vi.fn(async () => {
      if (h.latest instanceof Error) throw h.latest;
      return h.latest;
    }),
  };
});

import { checkForNewGame, FULL_REFRESH_MS } from "@/lib/services/games/league-of-legends/auto-sync.service";
import { syncOrderRiotData } from "@/lib/services/games/league-of-legends/sync.service";
import { RiotRateLimitedError } from "@/lib/services/games/league-of-legends/riot-client";

const NOW = new Date("2026-11-14T12:00:00Z");
const fresh = new Date(NOW.getTime() - 60_000);

function seed(over: Record<string, unknown> = {}) {
  h.account = {
    puuid: "P",
    platform: "EUW1",
    profile: { latestMatchId: "EUW1_1", recentMatches: [] },
    profileSyncedAt: fresh,
    syncLeaseUntil: null,
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(syncOrderRiotData).mockClear();
  h.latest = ["EUW1_1"];
  h.dataAccess = true;
  seed();
});

describe("checkForNewGame", () => {
  it("does nothing (one Riot call) when no new game was played", async () => {
    expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "up_to_date" });
    expect(syncOrderRiotData).not.toHaveBeenCalled();
  });

  it("syncs when a new game appears", async () => {
    h.latest = ["EUW1_2"];
    expect(await checkForNewGame("o1", { now: NOW })).toMatchObject({ changed: true, trigger: "new_game" });
    expect(syncOrderRiotData).toHaveBeenCalledOnce();
  });

  it("syncs first time when there is no profile or PUUID", async () => {
    seed({ puuid: null });
    expect(await checkForNewGame("o1", { now: NOW })).toMatchObject({ changed: true, trigger: "first_sync" });
    seed({ profile: null, profileSyncedAt: null });
    expect(await checkForNewGame("o1", { now: NOW })).toMatchObject({ changed: true, trigger: "first_sync" });
  });

  it("refreshes periodically even without a new game", async () => {
    seed({ profileSyncedAt: new Date(NOW.getTime() - FULL_REFRESH_MS) });
    expect(await checkForNewGame("o1", { now: NOW })).toMatchObject({ changed: true, trigger: "periodic" });
  });

  it("does not run while another sync holds the lease", async () => {
    h.latest = ["EUW1_2"];
    seed({ syncLeaseUntil: new Date(NOW.getTime() + 30_000) });
    expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "up_to_date" });
    expect(syncOrderRiotData).not.toHaveBeenCalled();
  });

  it("backs off on Riot rate limits and when Riot is unavailable", async () => {
    h.latest = new RiotRateLimitedError(5);
    expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "rate_limited" });
    h.dataAccess = false;
    expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "unavailable" });
  });

  it("never calls Riot automatically for an account Riot reported missing or on another server", async () => {
    for (const code of ["not_found", "wrong_region"]) {
      h.latest = ["EUW1_2"];
      seed({ lastSyncErrorCode: code });
      expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "needs_account" });
    }
    expect(syncOrderRiotData).not.toHaveBeenCalled();
  });

  it("needs a Riot account with a supported server", async () => {
    h.account = null;
    expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "needs_account" });
    seed({ platform: "PH2" });
    expect(await checkForNewGame("o1", { now: NOW })).toEqual({ changed: false, reason: "needs_account" });
  });
});
