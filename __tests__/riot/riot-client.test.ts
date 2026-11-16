import { describe, it, expect, vi } from "vitest";
import {
  createRiotClient,
  RiotNotFoundError,
  RiotRateLimitedError,
  RiotUnavailableError,
} from "@/lib/services/games/league-of-legends/riot-client";
import { getRiotCapabilities, publicRiotCapabilities } from "@/lib/services/games/league-of-legends/capabilities";

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function setup(responses: Response[], key: string | null = "RGAPI-test") {
  let now = 1_000_000;
  const fetch = vi.fn(async () => responses.shift()!);
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  const client = createRiotClient({ fetch: fetch as unknown as typeof globalThis.fetch, sleep, now: () => now, apiKey: () => key });
  return { client, fetch, sleep, advance: (ms: number) => (now += ms) };
}

const HOST = "europe.api.riotgames.com";

describe("riot client", () => {
  it("sends the key only as X-Riot-Token header", async () => {
    const { client, fetch } = setup([res(200, { ok: 1 })]);
    await client.get(HOST, "/riot/account/v1/accounts/by-riot-id/a/b");
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).not.toContain("RGAPI");
    expect((init.headers as Record<string, string>)["X-Riot-Token"]).toBe("RGAPI-test");
  });

  it("refuses hosts outside the Riot routing table", async () => {
    const { client, fetch } = setup([]);
    await expect(client.get("evil.example.com", "/x")).rejects.toBeInstanceOf(RiotUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails cleanly without a key", async () => {
    const { client } = setup([], null);
    await expect(client.get(HOST, "/x")).rejects.toBeInstanceOf(RiotUnavailableError);
  });

  it("retries a short Retry-After 429 then succeeds", async () => {
    const { client, sleep } = setup([res(429, {}, { "Retry-After": "2" }), res(200, [1])]);
    await expect(client.get(HOST, "/x")).resolves.toEqual([1]);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("long Retry-After puts the host in cooldown (no further calls)", async () => {
    const { client, fetch, advance } = setup([res(429, {}, { "Retry-After": "60" }), res(200, [1])]);
    await expect(client.get(HOST, "/x")).rejects.toBeInstanceOf(RiotRateLimitedError);
    await expect(client.get(HOST, "/y")).rejects.toBeInstanceOf(RiotRateLimitedError);
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(61_000);
    await expect(client.get(HOST, "/y")).resolves.toEqual([1]);
  });

  it("backs off on 5xx", async () => {
    const { client, sleep } = setup([res(503), res(503), res(200, "ok")]);
    await expect(client.get(HOST, "/x")).resolves.toBe("ok");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it("maps 404 to RiotNotFoundError", async () => {
    const { client } = setup([res(404)]);
    await expect(client.get(HOST, "/x")).rejects.toBeInstanceOf(RiotNotFoundError);
  });

  it("caches when a TTL is given", async () => {
    const { client, fetch } = setup([res(200, { a: 1 })]);
    await client.get(HOST, "/x", { cacheTtlMs: 1000 });
    await client.get(HOST, "/x", { cacheTtlMs: 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("riot capabilities", () => {
  it("no key -> no data access", () => {
    expect(getRiotCapabilities({}).dataAccess).toBe(false);
    expect(getRiotCapabilities({ RIOT_LOL_API_KEY: "your_riot_development_api_key" }).apiKeyConfigured).toBe(false);
  });
  it("a key alone does not authorize access (product approval required)", () => {
    const c = getRiotCapabilities({ RIOT_LOL_API_KEY: "RGAPI-x", NODE_ENV: "production" });
    expect(c.dataAccess).toBe(false);
    expect(c.reason).toMatch(/pending Riot product approval/);
  });
  it("production key + declared approval -> access", () => {
    expect(
      getRiotCapabilities({ RIOT_LOL_API_KEY: "RGAPI-x", RIOT_API_KEY_TIER: "production", RIOT_PRODUCT_APPROVED: "true", NODE_ENV: "production" }).dataAccess
    ).toBe(true);
  });
  it("dev-key local mode never works in production runtime", () => {
    expect(getRiotCapabilities({ RIOT_LOL_API_KEY: "RGAPI-x", RIOT_ALLOW_DEV_KEY_LOCAL: "true", NODE_ENV: "development" }).dataAccess).toBe(true);
    expect(getRiotCapabilities({ RIOT_LOL_API_KEY: "RGAPI-x", RIOT_ALLOW_DEV_KEY_LOCAL: "true", NODE_ENV: "production" }).dataAccess).toBe(false);
  });
  it("RSO is never claimed as available", () => {
    expect(getRiotCapabilities({ RIOT_LOL_API_KEY: "RGAPI-x", RIOT_API_KEY_TIER: "production", RIOT_PRODUCT_APPROVED: "true" }).rso).toBe(false);
  });
  it("public projection exposes no key material", () => {
    const pub = publicRiotCapabilities(getRiotCapabilities({ RIOT_LOL_API_KEY: "RGAPI-secret" }));
    expect(JSON.stringify(pub)).not.toContain("RGAPI");
    expect(Object.keys(pub).sort()).toEqual(["dataAccess", "reason", "rso"]);
  });
});
