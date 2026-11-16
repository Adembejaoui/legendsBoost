import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ provider: "mock" as string }));
vi.mock("@/lib/config", () => ({ getConfig: vi.fn(async () => h.provider) }));
vi.mock("@/lib/services/games/league-of-legends/shared-client", () => ({ getRiotClient: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { getRankProvider, MockRankProvider } from "@/lib/providers/rank";
import { FakeMailer, getMailer, setMailer } from "@/lib/providers/mail";

describe("RankProvider", () => {
  it("MockRankProvider serves scripted data and 404s the rest", async () => {
    const p = new MockRankProvider({
      accounts: { "faker#kr1": { puuid: "P1", gameName: "Faker", tagLine: "KR1" } },
      matchIds: { P1: ["KR_3", "KR_2", "KR_1"] },
    });
    expect(await p.resolveAccount("KR", "Faker", "KR1")).toMatchObject({ puuid: "P1" });
    await expect(p.resolveAccount("KR", "Nobody", "000")).rejects.toMatchObject({ name: "RiotNotFoundError" });
    expect(await p.getRecentMatchIds("KR", "P1", 2)).toEqual(["KR_3", "KR_2"]);
    expect(await p.getRankedEntries("KR", "P1")).toEqual([]);
  });

  it("is selected by config tracker_provider; manual is not available yet", async () => {
    h.provider = "mock";
    expect((await getRankProvider()).kind).toBe("mock");
    h.provider = "riot";
    expect((await getRankProvider()).kind).toBe("riot");
    h.provider = "manual";
    await expect(getRankProvider()).rejects.toThrow(/Phase 5/);
  });
});

describe("Mailer", () => {
  it("defaults to a log-only mailer and can be swapped for a fake", async () => {
    expect(getMailer().kind).toBe("log");
    const fake = new FakeMailer();
    setMailer(fake);
    await getMailer().send({ to: "a@example.test", subject: "Paid", text: "ok", tag: "payment-confirmed" });
    expect(fake.sent).toHaveLength(1);
    setMailer(null);
  });
});
