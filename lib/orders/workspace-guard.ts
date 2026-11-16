import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRealtimeEligibleUser, type SessionUser } from "@/lib/auth/guards";
import {
  resolveWorkspaceAccess,
  WORKSPACE_ACCESS_SELECT,
  type WorkspaceAccess,
  type WorkspaceAccessOrder,
} from "./workspace-access";

export type WorkspaceGuardResult =
  | { ok: true; user: SessionUser; order: WorkspaceAccessOrder; access: WorkspaceAccess }
  | { ok: false; response: NextResponse };

/**
 * Authenticate the caller and resolve their workspace access for `orderId`.
 * Unknown orders and orders the caller may not see both return 404 so the
 * existence of other users' orders is not disclosed.
 */
export async function guardWorkspace(orderId: string): Promise<WorkspaceGuardResult> {
  // Same account-state gate as realtime: deleted users and boosters that are
  // not APPROVED (pending/rejected/suspended) get no workspace access.
  const user = await getRealtimeEligibleUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: WORKSPACE_ACCESS_SELECT,
  });
  const access = resolveWorkspaceAccess(user, order);
  if (!order || !access) {
    return { ok: false, response: NextResponse.json({ error: "Order not found" }, { status: 404 }) };
  }
  return { ok: true, user, order, access };
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}
