import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-supabase-jwt-secret-for-unit-tests-only-0123456789abcdef";

describe("realtime JWT (unit)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
  });

  it("issues and verifies a token with expected claims", async () => {
    const mod = await import("@/lib/supabase/realtime-auth");
    const { token, expiresInMs } = await mod.issueRealtimeToken({ userId: "user-1", role: "authenticated", channel: "private-user:user-1" });
    expect(typeof token).toBe("string");
    expect(expiresInMs).toBeGreaterThan(0);
    const payload = await mod.verifyRealtimeToken(token);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.role).toBe("authenticated");
    expect(payload?.aud).toBe("authenticated");
    expect(payload?.channel).toBe("private-user:user-1");
  });

  it("rejects invalid token", async () => {
    const mod = await import("@/lib/supabase/realtime-auth");
    expect(await mod.verifyRealtimeToken("not-a-jwt")).toBeNull();
  });

  it("rejects expired token", async () => {
    const mod = await import("@/lib/supabase/realtime-auth");
    const { token } = await mod.issueRealtimeToken({ userId: "user-1", role: "authenticated", ttlMs: -1000 });
    expect(await mod.verifyRealtimeToken(token)).toBeNull();
  });

  it("rejects token signed with different secret", async () => {
    let mod = await import("@/lib/supabase/realtime-auth");
    const { token } = await mod.issueRealtimeToken({ userId: "user-1", role: "authenticated" });
    vi.resetModules();
    process.env.SUPABASE_JWT_SECRET = "other-secret-0123456789abcdef0123456789abcdef";
    mod = await import("@/lib/supabase/realtime-auth");
    expect(await mod.verifyRealtimeToken(token)).toBeNull();
  });
});

