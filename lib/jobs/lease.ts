// Server-only module.
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";

/**
 * Job lease on the `jobLease` table: at most one run of a job at a time,
 * across every server instance. Taking the lease is ONE atomic statement
 * (insert, or update only when the previous lease expired), so two cron
 * invocations racing cannot both get it. A crashed run releases itself when
 * `leasedUntil` passes.
 */
export interface RawDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

const db = () => prisma as unknown as RawDb;

/** Returns the run id when the lease was taken, null when another run holds it. */
export async function acquireLease(name: string, ttlMs: number, raw: RawDb = db()): Promise<string | null> {
  const runId = randomUUID();
  const rows = await raw.$queryRaw<{ runId: string }[]>`
    INSERT INTO "jobLease" ("name", "leasedUntil", "runId", "lastStartedAt")
    VALUES (${name}, (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ttlMs / 1000}::float8), ${runId}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("name") DO UPDATE SET
      "leasedUntil" = EXCLUDED."leasedUntil",
      "runId" = EXCLUDED."runId",
      "lastStartedAt" = EXCLUDED."lastStartedAt"
    WHERE "jobLease"."leasedUntil" IS NULL OR "jobLease"."leasedUntil" < (now() AT TIME ZONE 'UTC')
    RETURNING "runId"`;
  return rows[0]?.runId === runId ? runId : null;
}

/** Release the lease (only if this run still holds it) and record the outcome. */
export async function releaseLease(name: string, runId: string, status: "ok" | "error", error: string | null, raw: RawDb = db()) {
  await raw.$executeRaw`
    UPDATE "jobLease" SET "leasedUntil" = NULL, "lastFinishedAt" = (now() AT TIME ZONE 'UTC'),
      "lastStatus" = ${status}, "lastError" = ${error}
    WHERE "name" = ${name} AND "runId" = ${runId}`;
}
