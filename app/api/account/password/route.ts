import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/guards";
import { AccountAuthError, changePassword } from "@/lib/auth/email-tokens";
import { passwordSchema } from "@/lib/auth/password-schema";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const schema = z.object({ currentPassword: z.string().max(200).optional(), newPassword: passwordSchema }).strict();

/** Does this account have a password (or only Google sign-in)? */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  return NextResponse.json({ hasPassword: Boolean(row?.passwordHash) });
}

/**
 * Change the password (current password required), or set one on a
 * Google-only account. Signs out every device; the page signs this one in
 * again with the new password.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await sharedRateLimit("pw-change", user.id, LIMITS.passwordChangePerUser);
  if (!limit.success) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    await changePassword(user.id, parsed.data.currentPassword ?? null, parsed.data.newPassword);
    return NextResponse.json({ ok: true, email: user.email });
  } catch (e) {
    if (e instanceof AccountAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("Password change failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Could not change the password. Please try again." }, { status: 500 });
  }
}
