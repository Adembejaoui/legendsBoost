import bcrypt from "bcryptjs";
import { logger } from "@/lib/logger";

const SALT_ROUNDS = 12;

// bcrypt truncates passwords longer than 72 bytes. Reject oversized inputs
// explicitly instead of silently truncating them.
const MAX_PASSWORD_BYTES = 72;

function isTooLargeForBcrypt(password: string): boolean {
  return Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES;
}

/**
 * Hash a plaintext password with bcrypt (12 salt rounds).
 * Never logs the password.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  if (isTooLargeForBcrypt(password)) {
    throw new Error("Password is too long");
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  return hash;
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 * Returns false instead of throwing on mismatch.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (typeof password !== "string" || typeof hash !== "string") {
    return false;
  }
  if (hash.length === 0) {
    return false;
  }

  try {
    return await bcrypt.compare(password, hash);
  } catch (err) {
    logger.error("Password verification failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function isPasswordHash(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("$");
}