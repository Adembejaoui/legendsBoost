import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { requestPasswordReset } from "@/lib/auth/email-tokens";
import { clientIp, LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

/**
 * Ask for a password reset link. Always answers the same way, whether the
 * account exists or not (no account enumeration). Limited per email and IP.
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const { email } = parsed.data;

  const [byIp, byEmail] = await Promise.all([
    sharedRateLimit("pw-reset-ip", clientIp(req.headers), LIMITS.passwordResetPerIp),
    sharedRateLimit("pw-reset-email", email, LIMITS.passwordResetPerEmail),
  ]);
  if (!byIp.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfterSec) } }
    );
  }
  // Over the per-email limit: answer as usual but send nothing (no hint to
  // an attacker, no mail flood for the owner).
  if (byEmail.success) {
    try {
      await requestPasswordReset(email);
    } catch (e) {
      logger.error("Password reset request failed", { error: e instanceof Error ? e.name : "unknown" });
    }
  }
  return NextResponse.json({ ok: true });
}
