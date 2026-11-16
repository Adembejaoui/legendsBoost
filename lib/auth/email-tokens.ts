// Server-only module.
/**
 * Password reset, email verification and password change (production audit,
 * 2026-11-15).
 *
 *  - Tokens are 32 random bytes; only their SHA-256 hash is stored (table
 *    verificationToken, identifier "<purpose>:<userId>"), so a database leak
 *    does not give working links. Single use, consumed atomically.
 *  - Reset links live 1 hour, verification links 48 hours.
 *  - A password reset or change bumps user.sessionVersion: every session
 *    signed in before stops working.
 *  - Requesting a reset always answers the same way (no account enumeration).
 */
import { createHash, randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { appUrl, sendEmail } from "@/lib/email/send";
import { audit } from "@/lib/audit";

export type TokenPurpose = "reset" | "verify";
const TTL_MS: Record<TokenPurpose, number> = { reset: 60 * 60_000, verify: 48 * 60 * 60_000 };

export class AccountAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AccountAuthError";
  }
}

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const identifier = (purpose: TokenPurpose, userId: string) => `${purpose}:${userId}`;

/** Create a token (replacing older ones of the same purpose) and return the raw value for the link. */
export async function issueToken(purpose: TokenPurpose, userId: string, now = new Date()): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: identifier(purpose, userId) } }),
    prisma.verificationToken.create({
      data: { identifier: identifier(purpose, userId), token: hashToken(raw), expires: new Date(now.getTime() + TTL_MS[purpose]) },
    }),
  ]);
  return raw;
}

/** Use a token once. Returns the user id, or null when unknown, used or expired. */
export async function consumeToken(purpose: TokenPurpose, raw: string, now = new Date()): Promise<string | null> {
  if (!raw || raw.length > 200) return null;
  const token = hashToken(raw);
  const row = await prisma.verificationToken.findUnique({ where: { token } });
  if (!row || !row.identifier.startsWith(`${purpose}:`)) return null;
  // Atomic: only one request can delete the row.
  const deleted = await prisma.verificationToken.deleteMany({ where: { token } });
  if (deleted.count !== 1 || row.expires <= now) return null;
  return row.identifier.slice(purpose.length + 1);
}

/** Step 1 of a reset. Never reveals whether the account exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, deletedAt: true } });
  if (!user || user.deletedAt) return;
  const raw = await issueToken("reset", user.id);
  await sendEmail({
    to: user.email,
    subject: "Reset your LegendsBoost password",
    text: "We received a request to reset the password of your LegendsBoost account.\n\nThe link works once and expires in 1 hour. If you did not ask for this, you can ignore this email: your password stays the same.",
    action: { label: "Choose a new password", url: `${appUrl()}/reset-password?token=${raw}` },
  });
}

/** Step 2 of a reset: set the new password, end all sessions, confirm the email. */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const userId = await consumeToken("reset", rawToken);
  if (!userId) throw new AccountAuthError("This link is no longer valid. Ask for a new one.", 400);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, deletedAt: true, emailVerified: true } });
  if (!user || user.deletedAt) throw new AccountAuthError("This link is no longer valid. Ask for a new one.", 400);
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      sessionVersion: { increment: 1 },
      // Opening the link proves the mailbox belongs to them.
      ...(user.emailVerified ? {} : { emailVerified: new Date() }),
    },
  });
  await audit({ actorId: user.id, action: "PASSWORD_RESET", entityType: "user", entityId: user.id });
  await sendEmail({
    to: user.email,
    subject: "Your LegendsBoost password was changed",
    text: "The password of your LegendsBoost account was just changed, and all devices were signed out.\n\nIf this was not you, reset your password now and contact support.",
    action: { label: "Reset password", url: `${appUrl()}/forgot-password` },
  });
}

/** Signed-in user changes (or, for Google-only accounts, sets) the password. */
export async function changePassword(userId: string, currentPassword: string | null, newPassword: string): Promise<{ sessionVersion: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, passwordHash: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new AccountAuthError("Account not found.", 404);
  if (user.passwordHash) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AccountAuthError("Your current password is not correct.", 400);
    }
  }
  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  await audit({ actorId: user.id, action: "PASSWORD_CHANGED", entityType: "user", entityId: user.id });
  await sendEmail({
    to: user.email,
    subject: "Your LegendsBoost password was changed",
    text: "The password of your LegendsBoost account was just changed, and all devices were signed out.\n\nIf this was not you, reset your password now and contact support.",
    action: { label: "Reset password", url: `${appUrl()}/forgot-password` },
  });
  return updated;
}

/** Send (or resend) the "confirm your email" link. No-op when already confirmed. */
export async function sendVerificationEmail(userId: string): Promise<{ alreadyVerified: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerified: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new AccountAuthError("Account not found.", 404);
  if (user.emailVerified) return { alreadyVerified: true };
  const raw = await issueToken("verify", user.id);
  await sendEmail({
    to: user.email,
    subject: "Confirm your email address",
    text: "Welcome to LegendsBoost. Please confirm that this email address is yours.\n\nThe link expires in 48 hours.",
    action: { label: "Confirm my email", url: `${appUrl()}/verify-email?token=${raw}` },
  });
  return { alreadyVerified: false };
}

export async function verifyEmail(rawToken: string): Promise<boolean> {
  const userId = await consumeToken("verify", rawToken);
  if (!userId) return false;
  const r = await prisma.user.updateMany({ where: { id: userId, deletedAt: null }, data: { emailVerified: new Date() } });
  return r.count === 1;
}
