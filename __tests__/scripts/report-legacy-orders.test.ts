// @vitest-environment node
/**
 * Safety properties of scripts/report-legacy-orders.mjs. No database is
 * contacted: the runtime cases exit before connecting, or target a closed
 * local port.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "..", "scripts", "report-legacy-orders.mjs");
const source = readFileSync(SCRIPT, "utf8");
// Code without comments, so the doc text cannot satisfy or break the checks.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function run(env: Record<string, string | undefined>, args: string[] = []) {
  // Minimal environment: nothing from the developer's shell (e.g. a real
  // DATABASE_URL) leaks into the child process.
  const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) cleanEnv[k] = v;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: cleanEnv as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 20000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("report-legacy-orders.mjs is read-only", () => {
  it("issues no write or DDL statements", () => {
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|VACUUM|REINDEX)\b/);
    expect(code).not.toMatch(/\bCOMMIT\b/);
  });

  it("runs inside read-only guards and rolls back", () => {
    expect(code).toContain("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    expect(code).toContain('"BEGIN READ ONLY"');
    expect(code).toContain('"ROLLBACK"');
    // The read-only session is set before the first data query.
    expect(code.indexOf("READ ONLY")).toBeLessThan(code.indexOf("information_schema"));
  });

  it("never reads DATABASE_URL / DIRECT_URL or loads .env", () => {
    expect(code).not.toMatch(/process\.env\.(DATABASE_URL|DIRECT_URL)/);
    expect(code).not.toMatch(/dotenv/);
    expect(code).toMatch(/process\.env\.LEGACY_REPORT_DATABASE_URL/);
  });
});

describe("report-legacy-orders.mjs runtime guards", () => {
  it("refuses to run without LEGACY_REPORT_DATABASE_URL, even if DATABASE_URL is set", () => {
    const r = run({ DATABASE_URL: "postgresql://u:sentinel-pass@example.invalid:5432/db" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("LEGACY_REPORT_DATABASE_URL");
    expect(r.out).not.toContain("sentinel-pass");
  });

  it("rejects an invalid URL without echoing it", () => {
    const r = run({ LEGACY_REPORT_DATABASE_URL: "not a url sentinel-pass" });
    expect(r.code).toBe(2);
    expect(r.out).not.toContain("sentinel-pass");
  });

  it("--expect-host refuses a different host before connecting, without printing credentials", () => {
    const r = run(
      { LEGACY_REPORT_DATABASE_URL: "postgresql://report:sentinel-pass@db.production.invalid:5432/postgres" },
      ["--expect-host=db.staging.invalid"]
    );
    expect(r.code).toBe(2);
    expect(r.out).toContain("does not match");
    expect(r.out).not.toContain("sentinel-pass");
    expect(r.out).not.toContain("report:");
  });

  it("connection failures do not print the URL or password", () => {
    const r = run({ LEGACY_REPORT_DATABASE_URL: "postgresql://report:sentinel-pass@127.0.0.1:1/postgres" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Report failed");
    expect(r.out).not.toContain("sentinel-pass");
    expect(r.out).not.toContain("postgresql://");
  });
});
