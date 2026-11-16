import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { credentialPermissions, CredentialsError, revealCredentials } from "@/lib/orders/account-credentials.service";
import { logger } from "@/lib/logger";
import { clientIp, getOpenSession } from "@/lib/orders/sessions.service";

/**
 * POST: the booster actively working on the order reads the account login.
 * POST (not GET) so it is never prefetched or cached; every call is counted
 * and recorded as an order event visible to the customer.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, selectedMode: true } });
    const perms = credentialPermissions(g.access, order?.status ?? "", {
      duo: order?.selectedMode === "duo",
      hasOpenSession: !!(await getOpenSession(orderId, g.user.id)),
    });
    if (!perms.canReveal) {
      return forbidden(
        perms.sessionRequired
          ? "Start a session (and accept the rules) before viewing the login."
          : "Account details are only available to the booster while a solo order is in progress."
      );
    }
    const limit = await sharedRateLimit("acct-cred-reveal", `${g.user.id}:${orderId}`, LIMITS.credentialRevealPerUser);
    if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });

    const creds = await revealCredentials(orderId, g.user.id, { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") });
    return NextResponse.json(creds, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof CredentialsError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    logger.error("Account credentials reveal failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500, headers: NO_STORE });
  }
}
