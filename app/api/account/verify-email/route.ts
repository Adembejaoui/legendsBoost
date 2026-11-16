import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/guards";
import { AccountAuthError, sendVerificationEmail } from "@/lib/auth/email-tokens";
import { emailConfigured } from "@/lib/email/send";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

/** Send the "confirm your email" link again. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await sharedRateLimit("verify-email", user.id, LIMITS.verifyEmailPerUser);
  if (!limit.success) {
    return NextResponse.json({ error: "We already sent it. Check your inbox and spam folder, or try again in an hour." }, { status: 429 });
  }
  try {
    const r = await sendVerificationEmail(user.id);
    if (!r.alreadyVerified && !emailConfigured() && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Email is not available right now. Please try again later." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, alreadyVerified: r.alreadyVerified });
  } catch (e) {
    if (e instanceof AccountAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("Verification email failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Could not send the email. Please try again." }, { status: 500 });
  }
}
