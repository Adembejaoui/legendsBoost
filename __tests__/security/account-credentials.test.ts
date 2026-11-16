import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  credentialsConfigured,
  CredentialsConfigError,
  CredentialsDecryptError,
  decryptCredentials,
  encryptCredentials,
  maskUsername,
} from "@/lib/security/account-credentials";
import { credentialPermissions, credentialsInputSchema } from "@/lib/orders/account-credentials.service";
import { resolveWorkspaceAccess } from "@/lib/orders/workspace-access";

const env = { ACCOUNT_CREDENTIALS_KEY: randomBytes(32).toString("base64") };
const otherEnv = { ACCOUNT_CREDENTIALS_KEY: randomBytes(32).toString("base64") };
const creds = { username: "my.login", password: "  p@ss wörd \"quoted\"  " };

describe("account credential encryption", () => {
  it("round-trips exactly (password not trimmed)", () => {
    const ct = encryptCredentials("order-1", creds, env);
    expect(decryptCredentials("order-1", ct, env)).toEqual(creds);
  });

  it("never contains the plaintext and uses a fresh IV each time", () => {
    const a = encryptCredentials("order-1", creds, env);
    const b = encryptCredentials("order-1", creds, env);
    expect(a).not.toEqual(b);
    expect(a).not.toContain("my.login");
    expect(a).not.toContain("p@ss");
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("is bound to its order id", () => {
    const ct = encryptCredentials("order-1", creds, env);
    expect(() => decryptCredentials("order-2", ct, env)).toThrow(CredentialsDecryptError);
  });

  it("rejects a wrong key and tampering", () => {
    const ct = encryptCredentials("order-1", creds, env);
    expect(() => decryptCredentials("order-1", ct, otherEnv)).toThrow(CredentialsDecryptError);
    const parts = ct.split(".");
    const body = Buffer.from(parts[3], "base64url");
    body[0] ^= 1;
    parts[3] = body.toString("base64url");
    expect(() => decryptCredentials("order-1", parts.join("."), env)).toThrow(CredentialsDecryptError);
    expect(() => decryptCredentials("order-1", "garbage", env)).toThrow(CredentialsDecryptError);
  });

  it("refuses to run without a valid 32-byte key", () => {
    expect(credentialsConfigured({})).toBe(false);
    expect(credentialsConfigured({ ACCOUNT_CREDENTIALS_KEY: "YOUR_BASE64_32_BYTE_KEY" })).toBe(false);
    expect(credentialsConfigured(env)).toBe(true);
    expect(() => encryptCredentials("o", creds, {})).toThrow(CredentialsConfigError);
  });

  it("masks usernames", () => {
    expect(maskUsername("abcdefgh")).toBe("ab•••gh");
    expect(maskUsername("abc")).toBe("•••");
    expect(maskUsername("abcdefgh")).not.toContain("cdef");
  });

  it("validates input strictly", () => {
    expect(credentialsInputSchema.safeParse({ username: "a", password: "b" }).success).toBe(true);
    expect(credentialsInputSchema.safeParse({ username: "", password: "b" }).success).toBe(false);
    expect(credentialsInputSchema.safeParse({ username: "a", password: "" }).success).toBe(false);
    expect(credentialsInputSchema.safeParse({ username: "a", password: "b", extra: 1 }).success).toBe(false);
  });
});

describe("credential permissions", () => {
  const order = (status: string, assignmentStatus = "IN_PROGRESS") => ({
    id: "o1",
    userId: "cust",
    status,
    assignments: [{ id: "a1", boosterId: "boost", status: assignmentStatus, activeOrderId: "o1" }],
  });
  const perms = (user: { id: string; role: string }, o: ReturnType<typeof order>, opts: { duo?: boolean; hasOpenSession?: boolean } = {}) => {
    const access = resolveWorkspaceAccess(user, o);
    return access ? credentialPermissions(access, o.status, opts) : null;
  };
  const none = { duo: false, sessionRequired: false };
  const customer = { id: "cust", role: "CUSTOMER" };
  const booster = { id: "boost", role: "BOOSTER" };
  const admin = { id: "adm", role: "ADMIN" };

  it("customer owner can edit but never reveal", () => {
    expect(perms(customer, order("IN_PROGRESS"))).toEqual({ canEdit: true, canReveal: false, canDelete: true, ...none });
    // An unpaid checkout hold is not an order: no access at all.
    expect(perms(customer, order("AWAITING_PAYMENT"))).toBeNull();
    expect(perms(customer, order("COMPLETED", "COMPLETED"))).toEqual({ canEdit: false, canReveal: false, canDelete: false, ...none });
  });

  it("only the active booster can reveal, only while in progress, and only during a session", () => {
    // Phase 4: a play session must be open.
    expect(perms(booster, order("IN_PROGRESS"))).toEqual({ canEdit: false, canReveal: false, canDelete: false, duo: false, sessionRequired: true });
    expect(perms(booster, order("IN_PROGRESS"), { hasOpenSession: true })).toEqual({ canEdit: false, canReveal: true, canDelete: false, ...none });
    expect(perms(booster, order("PAUSED", "PAUSED"))?.canReveal).toBe(false);
    expect(perms({ id: "other", role: "BOOSTER" }, order("IN_PROGRESS"))).toBeNull();
    expect(perms(booster, order("COMPLETED", "COMPLETED"))?.canReveal).toBe(false);
  });

  it("admin can remove but never reveal or edit", () => {
    expect(perms(admin, order("IN_PROGRESS"))).toEqual({ canEdit: false, canReveal: false, canDelete: true, ...none });
  });

  it("duo orders: nobody edits or reveals a login", () => {
    expect(perms(customer, order("IN_PROGRESS"), { duo: true })).toMatchObject({ canEdit: false, duo: true });
    expect(perms(booster, order("IN_PROGRESS"), { duo: true, hasOpenSession: true })).toMatchObject({ canReveal: false, sessionRequired: false });
  });

  it("another customer gets nothing", () => {
    expect(perms({ id: "x", role: "CUSTOMER" }, order("IN_PROGRESS"))).toBeNull();
  });
});
