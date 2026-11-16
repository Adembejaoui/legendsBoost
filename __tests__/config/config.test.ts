import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as { key: string; value: unknown }[],
  fail: false,
  upserts: [] as unknown[],
  audits: [] as unknown[],
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    appConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => h.rows.find((r) => r.key === where.key) ?? null),
      upsert: vi.fn(async (a: unknown) => h.upserts.push(a)),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: { create: vi.fn(async (a: unknown) => h.audits.push(a)) },
  };
  return {
    default: {
      appConfig: {
        findMany: vi.fn(async () => {
          if (h.fail) throw new Error("relation \"appConfig\" does not exist");
          return h.rows;
        }),
      },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  };
});

import { clearConfigCache, CONFIG_DEFAULTS, ConfigError, getConfig, listConfig, setConfig } from "@/lib/config";

beforeEach(() => {
  h.rows = [];
  h.fail = false;
  h.upserts = [];
  h.audits = [];
  clearConfigCache();
});

describe("config service", () => {
  it("returns defaults when nothing is overridden", async () => {
    expect(await getConfig("checkout_hold_ttl_min")).toBe(60);
    expect(await getConfig("lp_gain_adjust_bps")).toEqual(CONFIG_DEFAULTS.lp_gain_adjust_bps);
  });

  it("uses a valid override and ignores an invalid one", async () => {
    h.rows = [
      { key: "checkout_hold_ttl_min", value: 30 },
      { key: "start_sla_min", value: "soon" },
    ];
    expect(await getConfig("checkout_hold_ttl_min")).toBe(30);
    expect(await getConfig("start_sla_min")).toBe(60);
    const listed = await listConfig();
    expect(listed.find((c) => c.key === "checkout_hold_ttl_min")).toMatchObject({ value: 30, overridden: true });
    expect(listed.find((c) => c.key === "start_sla_min")).toMatchObject({ value: 60, overridden: false });
  });

  it("falls back to defaults when the table is unavailable (not migrated yet)", async () => {
    h.fail = true;
    expect(await getConfig("tracker_provider")).toBe("riot");
  });

  it("setConfig validates, writes and audits in one transaction", async () => {
    await setConfig("admin-1", "checkout_hold_ttl_min", 45);
    expect(h.upserts).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ data: { actorId: "admin-1", action: "CONFIG_CHANGED", entityType: "config", entityId: "checkout_hold_ttl_min" } });
    await expect(setConfig("admin-1", "checkout_hold_ttl_min", -5)).rejects.toThrow(ConfigError);
    await expect(setConfig("admin-1", "no_such_key", 1)).rejects.toThrow(/Unknown config key/);
    await expect(setConfig("admin-1", "tracker_provider", "carrier-pigeon")).rejects.toThrow(ConfigError);
  });
});
