/**
 * Supabase Realtime channel access policies.
 *
 * Single source of truth for who may subscribe to which private channel.
 * Used by the Realtime token endpoint (`/api/realtime/auth`) before issuing a
 * short-lived Realtime JWT, and available for reuse by any server-side code
 * that needs to answer "can this user subscribe to this channel?".
 *
 * Policies:
 *  - order:{orderId}  → order customer, assigned booster (active assignment),
 *                       or admin (per existing admin permissions).
 *  - user:{userId}    → only the user themself. Admins do NOT automatically
 *                       subscribe to every user's private notification channel
 *                       unless an explicit admin capability requires it.
 *  - support:{ticketId} → ticket customer, or any admin.
 *
 * Arbitrary channels are rejected. Browser-supplied identities are never
 * trusted: the caller passes a server-validated user.
 */

import { UserRole } from "@/lib/auth/permissions";
import { canAccessConversation } from "@/lib/chat/service";
import { parseChannel } from "./channel-names";
import prisma from "@/lib/prisma";
import { hasBoosterAccess } from "@/lib/boosters/status";

export interface AuthedUser {
  id: string;
  role: UserRole;
  email?: string | null;
}

async function assertUserEligibleForRealtime(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      boosterProfile: { select: { verificationStatus: true } },
    },
  });
  if (!user) return false;
  const role = (user.role ?? "CUSTOMER") as UserRole;
  if (role === "BOOSTER") {
    return !!user.boosterProfile && hasBoosterAccess(user.boosterProfile.verificationStatus);
  }
  return true;
}

export interface ChannelAccessResult {
  allowed: boolean;
  channel: string | null;
  reason?: string;
}

/**
 * Authorize access to a private Realtime channel for an authenticated user.
 *
 * Never trusts the channel's embedded IDs as proof of ownership; each rule
 * re-validates against the database.
 */
export async function canAccessChannel(
  user: AuthedUser,
  channel: string
): Promise<ChannelAccessResult> {
  // Revalidate canonical DB account state on every authorization check.
  if (!(await assertUserEligibleForRealtime(user.id))) {
    return { allowed: false, channel: null, reason: "Account not eligible" };
  }

  const parsed = parseChannel(channel);
  if (!parsed) {
    return { allowed: false, channel: null, reason: "Unknown channel" };
  }

  switch (parsed.kind) {
    case "order": {
      const allowed = await canAccessConversation(
        user.id,
        user.role,
        parsed.orderId
      );
      return {
        allowed,
        channel,
        reason: allowed ? undefined : "Not authorized for this order",
      };
    }
    case "user": {
      // A user may subscribe only to their own private channel. Admins are not
      // granted blanket access to every user's notification channel here.
      const allowed = parsed.userId === user.id;
      return {
        allowed,
        channel,
        reason: allowed ? undefined : "Users may only subscribe to their own channel",
      };
    }
    case "pool": {
      // Signals only (no order data); boosters with access (checked above).
      const allowed = user.role === "BOOSTER";
      return { allowed, channel, reason: allowed ? undefined : "Only boosters receive pool updates" };
    }
    case "support": {
      const allowed = await canAccessSupportTicket(
        parsed.ticketId,
        user.id,
        user.role
      );
      return {
        allowed,
        channel,
        reason: allowed ? undefined : "Not authorized for this support ticket",
      };
    }
  }
}

/**
 * Support ticket access: ticket customer, or any admin.
 */
async function canAccessSupportTicket(
  ticketId: string,
  userId: string,
  userRole: UserRole
): Promise<boolean> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { customerId: true, assignedAdminId: true },
  });
  if (!ticket) return false;
  if (ticket.customerId === userId) return true;
  if (userRole === "ADMIN") return true;
  return false;
}
