// Server-only module: never import from a "use client" file.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level encryption for game-account credentials.
 *
 *  - AES-256-GCM (authenticated): tampering or a wrong key fails to decrypt.
 *  - 32-byte key from ACCOUNT_CREDENTIALS_KEY (base64), held only in server
 *    env, never in the database. A database dump alone reveals nothing.
 *  - Fresh random 96-bit IV per encryption.
 *  - Additional authenticated data binds each ciphertext to its order id, so
 *    a ciphertext copied onto another order cannot be decrypted there.
 *  - Format: "v1.<iv>.<tag>.<ciphertext>" (base64url), versioned for rotation.
 *
 * Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

export const CREDENTIALS_KEY_ENV = "ACCOUNT_CREDENTIALS_KEY";
const VERSION = "v1";
export const CREDENTIALS_KEY_VERSION = 1;

export class CredentialsConfigError extends Error {
  constructor() {
    super(`${CREDENTIALS_KEY_ENV} is missing or not a base64 32-byte key`);
    this.name = "CredentialsConfigError";
  }
}

export class CredentialsDecryptError extends Error {
  constructor() {
    super("Stored credentials could not be decrypted");
    this.name = "CredentialsDecryptError";
  }
}

export interface AccountCredentials {
  username: string;
  password: string;
}

function loadKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env[CREDENTIALS_KEY_ENV]?.trim();
  if (!raw) throw new CredentialsConfigError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new CredentialsConfigError();
  return key;
}

export function credentialsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    loadKey(env);
    return true;
  } catch {
    return false;
  }
}

function aad(orderId: string) {
  return Buffer.from(`order-account-credential:${VERSION}:${orderId}`, "utf8");
}

export function encryptCredentials(
  orderId: string,
  creds: AccountCredentials,
  env?: Record<string, string | undefined>
): string {
  const key = loadKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(orderId));
  const plaintext = Buffer.from(JSON.stringify({ u: creds.username, p: creds.password }), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  plaintext.fill(0);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptCredentials(
  orderId: string,
  payload: string,
  env?: Record<string, string | undefined>
): AccountCredentials {
  const key = loadKey(env);
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new CredentialsDecryptError();
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new CredentialsDecryptError();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(orderId));
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const obj = JSON.parse(pt.toString("utf8")) as { u?: unknown; p?: unknown };
    pt.fill(0);
    if (typeof obj.u !== "string" || typeof obj.p !== "string") throw new CredentialsDecryptError();
    return { username: obj.u, password: obj.p };
  } catch {
    throw new CredentialsDecryptError();
  }
}

/** "abcdef" -> "ab•••ef"; short values are fully masked. Never the full login. */
export function maskUsername(username: string): string {
  const u = username.trim();
  if (u.length <= 4) return "•".repeat(Math.max(u.length, 3));
  return `${u.slice(0, 2)}•••${u.slice(-2)}`;
}

/* ------------------------------------------------------------------ */
/* Other secrets (Phase 7: booster payout details)                     */
/* ------------------------------------------------------------------ */

function secretAad(context: string) {
  return Buffer.from(`secret:${VERSION}:${context}`, "utf8");
}

/**
 * Encrypt any small secret with the same key, bound to a context string
 * (e.g. "payout-method:<boosterId>"): a ciphertext moved to another context
 * does not decrypt.
 */
export function encryptSecret(context: string, plaintext: string, env?: Record<string, string | undefined>): string {
  const key = loadKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(secretAad(context));
  const pt = Buffer.from(plaintext, "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  pt.fill(0);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(context: string, payload: string, env?: Record<string, string | undefined>): string {
  const key = loadKey(env);
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new CredentialsDecryptError();
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new CredentialsDecryptError();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(secretAad(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new CredentialsDecryptError();
  }
}
