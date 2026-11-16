// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Password reset, email verification and password change against an
 * in-memory PostgreSQL (all migrations).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; action?: { url: string } }[], getSessionUser: vi.fn() }));

vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(async (m: any) => {
    h.sent.push(m);
    return { sent: true };
  }),
  appUrl: () => "https://app.test",
  emailConfigured: () => true,
}));

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { seedUser } from "../support/payment-fixtures";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { changePassword, consumeToken, issueToken, requestPasswordReset, resetPassword, sendVerificationEmail, verifyEmail } from "@/lib/auth/email-tokens";
import { sessionVersionOf } from "@/lib/auth/session-version";
import { POST as forgotRoute } from "@/app/api/auth/forgot-password/route";
import { POST as resetRoute } from "@/app/api/auth/reset-password/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;

beforeAll(async () => {
  prisma = await getTestPrisma();
}, 60_000);
afterAll(closeTestDb);
beforeEach(() => {
  h.sent.length = 0;
});

const post = (url: string, body: unknown, ip = "9.9.9.9") =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) }) as unknown as NextRequest;
const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

describe("tokens", () => {
  it("are stored hashed, work once, and a new one replaces the old one", async () => {
    const u = await seedUser("CUSTOMER");
    const first = await issueToken("reset", u.id);
    const second = await issueToken("reset", u.id);
    const rows = await prisma.verificationToken.findMany({ where: { identifier: `reset:${u.id}` } });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).not.toBe(second); // only the hash is stored
    expect(await consumeToken("reset", first)).toBeNull(); // replaced
    expect(await consumeToken("verify", second)).toBeNull(); // wrong purpose
    expect(await consumeToken("reset", second)).toBe(u.id);
    expect(await consumeToken("reset", second)).toBeNull(); // single use
  });

  it("expire", async () => {
    const u = await seedUser("CUSTOMER");
    const raw = await issueToken("reset", u.id, new Date(Date.now() - 2 * 60 * 60_000));
    expect(await consumeToken("reset", raw)).toBeNull();
  });
});

describe("password reset", () => {
  it("sends a link, sets the new password once, signs out every device and confirms the email", async () => {
    const u = await seedUser("CUSTOMER");
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword("old-password-1") } });

    await requestPasswordReset(`${u.id}@t.test`);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].action!.url).toContain("https://app.test/reset-password?token=");
    const token = tokenOf(h.sent[0].action!.url);

    await resetPassword(token, "new-password-2");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword("new-password-2", after.passwordHash!)).toBe(true);
    expect(after.sessionVersion).toBe(1);
    expect(after.emailVerified).toBeInstanceOf(Date);
    // A session signed in before the reset no longer matches.
    expect(await prisma.user.findUnique({ where: { id: u.id, sessionVersion: sessionVersionOf({ user: { sv: 0 } }) } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "PASSWORD_RESET", entityId: u.id } })).toBe(1);

    await expect(resetPassword(token, "another-password-3")).rejects.toMatchObject({ status: 400 }); // single use
  });

  it("the request answers the same for unknown emails and sends nothing", async () => {
    const res = await forgotRoute(post("http://t/api/auth/forgot-password", { email: "nobody@t.test" }, "1.1.1.1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.sent).toHaveLength(0);
    expect((await forgotRoute(post("http://t/api/auth/forgot-password", { email: "not-an-email" }, "1.1.1.1"))).status).toBe(400);
  });

  it("stops emailing an address after 3 requests an hour, without telling the caller", async () => {
    const u = await seedUser("CUSTOMER");
    for (let i = 0; i < 5; i++) {
      const res = await forgotRoute(post("http://t/api/auth/forgot-password", { email: `${u.id}@t.test` }, "2.2.2.2"));
      expect(res.status).toBe(200);
    }
    expect(h.sent).toHaveLength(3);
  });

  it("the reset route validates the password and refuses bad tokens", async () => {
    const u = await seedUser("CUSTOMER");
    const raw = await issueToken("reset", u.id);
    expect((await resetRoute(post("http://t/x", { token: raw, password: "short" }, "3.3.3.3"))).status).toBe(400);
    expect((await resetRoute(post("http://t/x", { token: "x".repeat(43), password: "long-enough-1" }, "3.3.3.3"))).status).toBe(400);
    expect((await resetRoute(post("http://t/x", { token: raw, password: "long-enough-1" }, "3.3.3.3"))).status).toBe(200);
  });
});

describe("email verification", () => {
  it("confirms the address with the link; nothing is sent once confirmed", async () => {
    const u = await seedUser("CUSTOMER");
    expect(await sendVerificationEmail(u.id)).toEqual({ alreadyVerified: false });
    const token = tokenOf(h.sent[0].action!.url);
    expect(await verifyEmail("wrong-token-value-that-does-not-exist")).toBe(false);
    expect(await verifyEmail(token)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerified).toBeInstanceOf(Date);
    expect(await verifyEmail(token)).toBe(false); // single use
    h.sent.length = 0;
    expect(await sendVerificationEmail(u.id)).toEqual({ alreadyVerified: true });
    expect(h.sent).toHaveLength(0);
  });
});

describe("change password", () => {
  it("needs the current password, then ends older sessions", async () => {
    const u = await seedUser("CUSTOMER");
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword("current-pass-1") } });
    await expect(changePassword(u.id, "wrong", "brand-new-pass-2")).rejects.toMatchObject({ status: 400 });
    await expect(changePassword(u.id, null, "brand-new-pass-2")).rejects.toMatchObject({ status: 400 });
    expect(await changePassword(u.id, "current-pass-1", "brand-new-pass-2")).toEqual({ sessionVersion: 1 });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword("brand-new-pass-2", after.passwordHash!)).toBe(true);
  });

  it("a Google-only account can set a password without a current one", async () => {
    const u = await seedUser("CUSTOMER");
    expect(await changePassword(u.id, null, "first-password-1")).toEqual({ sessionVersion: 1 });
  });
});
