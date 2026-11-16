/**
 * In-memory PostgreSQL for integration tests (PGlite, no external database).
 *
 * The database is built exactly the way a real environment gets there:
 *   1. the schema as it was before the payments migration (fixture), then
 *   2. prisma/migrations/20261114000000_payments_and_financial_ledger, then
 *   3. every later migration, in order (credentials, config/audit/jobs...).
 * So every test run also proves the migration SQL is valid and matches what
 * the generated Prisma client expects.
 *
 * PGlite is a single backend, so the pool has exactly one connection;
 * concurrent operations are serialised. Unique indexes, CHECK constraints,
 * triggers, conditional updates and transaction rollback are real Postgres.
 *
 * Known transport limitation (pglite-socket, not PostgreSQL): when a single
 * statement fails OUTSIDE a transaction, the next query on the connection
 * fails too. Tests that deliberately trigger a database error therefore do
 * it inside prisma.$transaction(...), which recovers cleanly.
 *
 * Usage in a test file:
 *   vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const ROOT = join(__dirname, "..", "..");
export const PAYMENTS_MIGRATION = join(
  ROOT,
  "prisma",
  "migrations",
  "20261114000000_payments_and_financial_ledger",
  "migration.sql"
);
const BEFORE_FIXTURE = join(__dirname, "fixtures", "schema-before-payments.sql");
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");

/** Migrations newer than the payments migration, oldest first. */
function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => /^[0-9]{14}_/.test(d) && d > "20261114000000_payments_and_financial_ledger")
    .sort()
    .map((d) => join(MIGRATIONS_DIR, d, "migration.sql"));
}

type TestDb = { prisma: PrismaClient; pglite: PGlite; close: () => Promise<void> };
let current: Promise<TestDb> | null = null;

async function start(): Promise<TestDb> {
  const pglite = await PGlite.create();
  await pglite.exec(readFileSync(BEFORE_FIXTURE, "utf8"));
  await pglite.exec(readFileSync(PAYMENTS_MIGRATION, "utf8"));
  for (const file of laterMigrations()) await pglite.exec(readFileSync(file, "utf8"));

  const server = new PGLiteSocketServer({ db: pglite, port: 0, host: "127.0.0.1" });
  await server.start();
  const address = (server as unknown as { server: { address(): { port: number } } }).server.address();
  const pool = new pg.Pool({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres`,
    max: 1,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    pglite,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
      await server.stop();
      await pglite.close();
    },
  };
}

/** One database per test file (module instance), created on first use. */
export async function getTestDb(): Promise<TestDb> {
  if (!current) current = start();
  return current;
}

export async function getTestPrisma(): Promise<PrismaClient> {
  return (await getTestDb()).prisma;
}

export async function closeTestDb(): Promise<void> {
  if (!current) return;
  const db = await current;
  current = null;
  await db.close();
}

let seq = 0;
/** Unique ids per test so files never need to truncate (the ledger cannot be truncated). */
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}
