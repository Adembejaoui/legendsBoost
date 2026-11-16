import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { AccountAuthError, resetPassword } from "@/lib/auth/email-tokens";
import { passwordSchema } from "@/lib/auth/password-schema";
import { clientIp, LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const schema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();

/** Set a new password with the link from the email. Ends every session of the account. */
export async function POST(req: NextRequest) {
  const limit = await sharedRateLimit("pw-reset-submit", clientIp(req.headers), LIMITS.passwordResetSubmitPerIp);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    await resetPassword(parsed.data.token, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccountAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("Password reset failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Could not reset the password. Please try again." }, { status: 500 });
  }
}
