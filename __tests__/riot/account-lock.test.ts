/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  access: { canEditRiotAccount: true, viewerRole: "customer" } as any,
  account: null as any,
  assignments: [] as any[],
  matchCount: 0,
  upsert: vi.fn(),
  del: vi.fn(),
  matchDelete: vi.fn(),
  event: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/lib/services/games/league-of-legends/riot-id-verification", () => ({ checkRiotIdExists: m.check }));

vi.mock("@/lib/orders/workspace-guard", () => ({
  guardWorkspace: vi.fn(async () => ({ ok: true, user: { id: "u-1" }, access: m.access })),
  forbidden: (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 403 }),
}));
vi.mock("@/lib/orders/tracking-service", () => ({ recordOrderEvent: m.event }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    orderRiotAccount: {
      findUnique: vi.fn(async () => m.account),
      upsert: m.upsert,
      delete: m.del,
    },
    orderBoosterAssignment: { findMany: vi.fn(async () => m.assignments) },
    orderMatch: { count: vi.fn(async () => m.matchCount), deleteMany: m.matchDelete },
  };
  return { default: { ...tx, $transaction: vi.fn(async (cb: any) => cb(tx)) } };
});

import { PATCH, DELETE } from "@/app/api/orders/[orderId]/game-account/route";
import { getRiotAccountLock } from "@/lib/orders/riot-account-lock";
import { sameRiotId } from "@/lib/services/games/league-of-legends/account.service";

const params = { params: Promise.resolve({ orderId: "order-1" }) };
const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as any, params);
const existing = { orderId: "order-1", gameName: "Player", tagLine: "EUW", platform: "EUW1", baselineAt: null, linkStatus: "RESOLVED" };

beforeEach(() => {
  vi.clearAllMocks();
  m.access = { canEditRiotAccount: true, viewerRole: "customer" };
  m.account = { ...existing };
  m.assignments = [];
  m.matchCount = 0;
  m.upsert.mockImplementation(async ({ create, update }: any) => ({ ...existing, ...create, ...update }));
  m.check.mockResolvedValue({ status: "unverified", message: "Riot verification is not available right now." });
});

describe("5. account modification after an assignment starts", () => {
  it("is refused (409) for the customer and nothing is written", async () => {
    m.assignments = [{ startedAt: new Date(), status: "IN_PROGRESS" }];
    const res = await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/boosting has started/);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("stays locked after the booster released/abandoned (work happened on this account)", async () => {
    m.assignments = [{ startedAt: new Date(), status: "RELEASED" }];
    expect((await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" })).status).toBe(409);
  });

  it("a declined assignment that never started does not lock", async () => {
    m.assignments = [{ startedAt: null, status: "DECLINED" }];
    expect((await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" })).status).toBe(200);
  });

  it("an admin may still correct it while no match is recorded", async () => {
    m.access = { canEditRiotAccount: true, viewerRole: "admin" };
    m.assignments = [{ startedAt: new Date(), status: "IN_PROGRESS" }];
    expect((await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" })).status).toBe(200);
    expect(m.upsert.mock.calls[0][0].update).toMatchObject({ puuid: null, matchScanUntil: null, pendingMatchIds: [] });
  });

  it("unlinking is refused too", async () => {
    m.assignments = [{ startedAt: new Date(), status: "PAUSED" }];
    const res = await DELETE(new Request("http://x", { method: "DELETE" }) as any, params);
    expect(res.status).toBe(409);
    expect(m.del).not.toHaveBeenCalled();
  });
});

describe("6. account modification when matches already exist", () => {
  it("is refused for everyone, admins included, and matches are never deleted", async () => {
    m.matchCount = 3;
    for (const role of ["customer", "admin"]) {
      m.access = { canEditRiotAccount: true, viewerRole: role };
      const res = await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/matches are already recorded/);
    }
    const del = await DELETE(new Request("http://x", { method: "DELETE" }) as any, params);
    expect(del.status).toBe(409);
    expect(m.matchDelete).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.del).not.toHaveBeenCalled();
  });

  it("a baseline alone locks non-admins (previous rule kept)", () => {
    expect(getRiotAccountLock({ baselineAt: new Date(), assignments: [], matchCount: 0 }, false).locked).toBe(true);
    expect(getRiotAccountLock({ baselineAt: new Date(), assignments: [], matchCount: 0 }, true).locked).toBe(false);
  });
});

describe("7. case-insensitive Riot ID comparison", () => {
  it("a capitalisation change is not a new account: no reset, no event, even while locked", async () => {
    m.assignments = [{ startedAt: new Date(), status: "IN_PROGRESS" }];
    m.matchCount = 4;
    const res = await patch({ gameName: "PLAYER", tagLine: "euw", platform: "EUW1" });
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("sameRiotId ignores case, surrounding spaces and a leading #", () => {
    expect(sameRiotId({ gameName: " Faker ", tagLine: "#KR1" }, { gameName: "faker", tagLine: "kr1" })).toBe(true);
    expect(sameRiotId({ gameName: "Faker", tagLine: "KR1" }, { gameName: "Faker", tagLine: "KR2" })).toBe(false);
  });

  it("a region change on the same Riot ID counts as a change (and is locked once work started)", async () => {
    m.assignments = [{ startedAt: new Date(), status: "IN_PROGRESS" }];
    expect((await patch({ gameName: "Player", tagLine: "EUW", platform: "EUN1" })).status).toBe(409);
  });

  it("adding the first Riot account is allowed (nothing to protect yet)", async () => {
    m.account = null;
    m.assignments = [{ startedAt: new Date(), status: "IN_PROGRESS" }];
    expect((await patch({ gameName: "Player", tagLine: "EUW", platform: "EUW1" })).status).toBe(200);
    expect(m.event).toHaveBeenCalledTimes(1);
  });

  it("an unsupported region is rejected at input", async () => {
    m.account = null;
    expect((await patch({ gameName: "Player", tagLine: "PHX", platform: "PH2" })).status).toBe(400);
  });
});

describe("Riot ID existence check before saving", () => {
  it("a name#tag that does not exist on Riot is refused (422) and nothing is stored", async () => {
    m.account = null;
    m.check.mockResolvedValue({ status: "not_found", message: "No Riot account named Nobody#XYZ exists." });
    const res = await patch({ gameName: "Nobody", tagLine: "XYZ", platform: "EUW1" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("an account on another server is refused with Riot's suggestion", async () => {
    m.account = null;
    m.check.mockResolvedValue({ status: "wrong_region", message: "Not on EUW1.", suggestedPlatform: "EUN1" });
    const res = await patch({ gameName: "Player", tagLine: "EUW", platform: "EUW1" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "wrong_region", suggestedPlatform: "EUN1" });
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("a verified account is stored with Riot's PUUID and spelling, ready to sync", async () => {
    m.account = null;
    m.check.mockResolvedValue({ status: "verified", puuid: "PUUID-1", gameName: "Player", tagLine: "EUW" });
    const res = await patch({ gameName: "player", tagLine: "euw", platform: "EUW1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verified: true });
    const { create } = m.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ gameName: "Player", tagLine: "EUW", puuid: "PUUID-1", linkStatus: "RESOLVED" });
    expect(create.regionVerifiedAt).toBeInstanceOf(Date);
  });

  it("if Riot can't be asked, the ID is saved unverified with a warning", async () => {
    m.account = null;
    const res = await patch({ gameName: "Player", tagLine: "EUW", platform: "EUW1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verified: false, warning: expect.any(String) });
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ puuid: null, linkStatus: "MANUAL" });
  });

  it("Riot is not called when nothing changed or when the account is locked", async () => {
    await patch({ gameName: "PLAYER", tagLine: "euw", platform: "EUW1" });
    m.assignments = [{ startedAt: new Date(), status: "IN_PROGRESS" }];
    await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" });
    expect(m.check).not.toHaveBeenCalled();
  });

  it("changing the Riot ID clears the previous account's profile snapshot", async () => {
    m.check.mockResolvedValue({ status: "verified", puuid: "P2", gameName: "Other", tagLine: "EUW" });
    expect((await patch({ gameName: "Other", tagLine: "EUW", platform: "EUW1" })).status).toBe(200);
    const { update } = m.upsert.mock.calls[0][0];
    expect(update.profileSyncedAt).toBeNull();
    expect(update.profile).toBeDefined();
  });
});
