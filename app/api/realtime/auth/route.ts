import { NextRequest, NextResponse } from "next/server";
import { getRealtimeEligibleUser } from "@/lib/auth/guards";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { issueRealtimeToken } from "@/lib/supabase/realtime-auth";
import { canAccessChannel } from "@/lib/realtime/authorization";
import { logger } from "@/lib/logger";

/**
 * POST /api/realtime/auth
 *
 * Auth.js <-> Supabase Realtime bridge.
 *
 * LegendsBoost keeps Auth.js as its authentication system. This endpoint
 * validates the Auth.js session, authorizes the caller for the requested
 * private Realtime channel, and issues a short-lived Supabase Realtime JWT
 * signed with `SUPABASE_JWT_SECRET` (server-only).
 *
 * The browser never supplies a trusted user ID; the user ID is derived solely
 * from the verified server-side session. Signing secrets are never returned.
 *
 * Rate-limited to prevent token-request brute force.
 *
 * Request body: { channel: "private-order:{orderId}" | "private-user:{userId}" | "private-support:{ticketId}" }
 * Response: { token, expiresInMs }
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await sharedRateLimit("realtime-auth", ip, LIMITS.realtimeAuthPerIp);

  if (!success) {
    logger.debug("Realtime auth rate limited", { ip });
    return NextResponse.json(
      { success: false, message: "Rate limit exceeded" },
      { status: 429 }
    );
  }

  try {
    const session = await getRealtimeEligibleUser();

    if (!session) {
      logger.debug("Realtime auth failed: no eligible session", { ip });
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      channel?: string;
    };
    const channel = body.channel;

    if (typeof channel !== "string" || !channel) {
      return NextResponse.json(
        { success: false, message: "Channel is required" },
        { status: 400 }
      );
    }

    // Authorize channel access before issuing any token. Never issue a token
    // for a channel the verified session does not permit.
    const authorization = await canAccessChannel(session, channel);
    if (!authorization.allowed) {
      logger.debug("Realtime auth failed: channel not authorized", {
        userId: session.id,
        channel,
        reason: authorization.reason,
      });
      return NextResponse.json(
        { success: false, message: "Forbidden: not authorized for this channel" },
        { status: 403 }
      );
    }

    const { token, expiresInMs } = await issueRealtimeToken({
      userId: session.id,
      role: "authenticated",
      channel,
    });

    logger.debug("Realtime auth token issued", {
      userId: session.id,
      channel,
    });

    return NextResponse.json({
      success: true,
      token,
      expiresInMs,
    });
  } catch (err) {
    logger.error("Realtime auth failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, message: "Internal error" },
      { status: 500 }
    );
  }
}
