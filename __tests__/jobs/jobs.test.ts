import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/payments/outbox", () => ({ dispatchOutbox: vi.fn(async () => ({ done: 0, failed: 0 })) }));
vi.mock("@/lib/payments/checkout.service", () => ({ closeStaleCheckoutHolds: vi.fn(async () => 0) }));

import { runJob, type JobDefinition } from "@/lib/jobs";
import type { RawDb } from "@/lib/jobs/lease";
import { GET } from "@/app/api/cron/[job]/route";

/** In-memory stand-in for the jobLease table with the same "take only if expired" rule. */
function fakeLeaseDb() {
  const leases = new Map<string, { until: number; runId: string; status?: string; error?: string | null }>();
  const raw: RawDb = {
    $queryRaw: (async (_q: TemplateStringsArray, ...v: unknown[]) => {
      const [name, secs, runId] = v as [string, number, string];
      const cur = leases.get(name);
      if (cur && cur.until > Date.now()) return [];
      leases.set(name, { until: Date.now() + secs * 1000, runId });
      return [{ runId }];
    }) as RawDb["$queryRaw"],
    $executeRaw: (async (_q: TemplateStringsArray, ...v: unknown[]) => {
      const [status, error, name, runId] = v as [string, string | null, string, string];
      const cur = leases.get(name);
      if (cur?.runId !== runId) return 0;
      leases.set(name, { until: 0, runId, status, error });
      return 1;
    }) as RawDb["$executeRaw"],
  };
  return { raw, leases };
}

describe("runJob", () => {
  it("runs a job once even when triggered twice at the same time", async () => {
    const { raw } = fakeLeaseDb();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const jobs: Record<string, JobDefinition> = { slow: { leaseMs: 60_000, run: async () => { runs++; await gate; return {}; } } };
    const a = runJob("slow", { jobs, raw });
    const b = await runJob("slow", { jobs, raw });
    expect(b).toEqual({ status: "skipped", job: "slow", reason: "locked" });
    release();
    expect((await a).status).toBe("ran");
    expect(runs).toBe(1);
    // Lease released: the next scheduled run goes through.
    expect((await runJob("slow", { jobs, raw })).status).toBe("ran");
  });

  it("records a failure and releases the lease", async () => {
    const { raw, leases } = fakeLeaseDb();
    const jobs: Record<string, JobDefinition> = { boom: { leaseMs: 60_000, run: async () => { throw new Error("db down"); } } };
    expect(await runJob("boom", { jobs, raw })).toMatchObject({ status: "failed", error: "Error: db down" });
    expect(leases.get("boom")).toMatchObject({ until: 0, status: "error" });
  });
});

describe("GET /api/cron/[job]", () => {
  const call = (job: string, auth?: string) =>
    GET(new Request(`http://x/api/cron/${job}`, { headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ job }) });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("is refused when no CRON_SECRET is configured", async () => {
    expect((await call("outbox-dispatch", "Bearer x")).status).toBe(503);
  });

  it("requires the exact bearer secret and a known job", async () => {
    process.env.CRON_SECRET = "s3cret-value-for-tests";
    expect((await call("outbox-dispatch")).status).toBe(401);
    expect((await call("outbox-dispatch", "Bearer wrong")).status).toBe(401);
    expect((await call("nope", "Bearer s3cret-value-for-tests")).status).toBe(404);
  });
});
