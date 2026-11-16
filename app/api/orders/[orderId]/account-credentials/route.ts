import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import {
  credentialPermissions,
  credentialsInputSchema,
  CredentialsError,
  deleteCredentials,
  getCredentialStatus,
  saveCredentials,
} from "@/lib/orders/account-credentials.service";
import { logger } from "@/lib/logger";

/**
 * Game-account login details for an order.
 *   GET    status only (saved?, masked username, reveal history). Never the password.
 *   PUT    customer owner saves / replaces { username, password } (encrypted at rest).
 *   DELETE customer owner or admin removes them.
 * The booster reads them through POST ./reveal (audited).
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function orderStatus(orderId: string) {
  return (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status ?? "";
}

async function isDuo(orderId: string) {
  return (await prisma.order.findUnique({ where: { id: orderId }, select: { selectedMode: true } }))?.selectedMode === "duo";
}

function errorResponse(e: unknown) {
  if (e instanceof CredentialsError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
  // Never log request bodies here: they contain a password.
  logger.error("Account credentials request failed", { error: e instanceof Error ? e.name : "unknown" });
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500, headers: NO_STORE });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    const perms = credentialPermissions(g.access, await orderStatus(orderId), { duo: await isDuo(orderId) });
    return NextResponse.json({ ...(await getCredentialStatus(orderId)), ...perms }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    if (!credentialPermissions(g.access, await orderStatus(orderId), { duo: await isDuo(orderId) }).canEdit) {
      return forbidden("Only the customer can set the account details of an open solo order.");
    }
    const limit = await sharedRateLimit("acct-cred-save", g.user.id, LIMITS.credentialSavePerUser);
    if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });

    const body = await req.json().catch(() => null);
    const parsed = credentialsInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400, headers: NO_STORE });
    }
    const status = await saveCredentials(orderId, g.user.id, parsed.data);
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    if (!credentialPermissions(g.access, await orderStatus(orderId)).canDelete) {
      return forbidden("You cannot remove the account details of this order.");
    }
    return NextResponse.json(await deleteCredentials(orderId, g.user.id), { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e);
  }
}
