// Server-only module: never import from a "use client" file.
import { z } from "zod";
import prisma from "@/lib/prisma";
import type { WorkspaceAccess } from "./workspace-access";
import { recordOrderEvent } from "./tracking-service";
import {
  CREDENTIALS_KEY_VERSION,
  credentialsConfigured,
  decryptCredentials,
  encryptCredentials,
  maskUsername,
  type AccountCredentials,
} from "@/lib/security/account-credentials";

/**
 * Game-account credentials for an order (customer -> assigned booster).
 *
 * Who may do what (re-checked server-side on every request):
 *  - Customer owner: save / replace / remove while the order is not finished
 *    (PENDING, IN_PROGRESS, PAUSED, DRAFT). They can never
 *    read the password back; they only see that it is saved.
 *  - Booster: reveal ONLY while holding the order's IN_PROGRESS assignment
 *    and the order is IN_PROGRESS (not paused by the customer). Each reveal is
 *    counted and recorded as an order event the customer can see.
 *  - Admin: may remove (e.g. on a dispute) but never reveal.
 * The row is deleted by a database trigger when the order is COMPLETED or
 * CANCELLED.
 */

// AWAITING_CONFIRMATION: the customer may still remove the saved login.
const EDITABLE_STATUSES = new Set(["PENDING", "CLAIMED", "IN_PROGRESS", "PAUSED", "AWAITING_CONFIRMATION", "DRAFT"]);

export const credentialsInputSchema = z
  .object({
    username: z.string().trim().min(1, "Username is required").max(100, "Username is too long"),
    // Passwords are taken verbatim (no trimming).
    password: z.string().min(1, "Password is required").max(200, "Password is too long"),
  })
  .strict();

import { getOpenSession } from "./sessions.service";
import { signalOrder } from "@/lib/realtime/live";

export class CredentialsError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CredentialsError";
  }
}

export interface CredentialPermissions {
  canEdit: boolean;
  canReveal: boolean;
  canDelete: boolean;
  /** Duo order: the booster plays with the customer, no login is shared. */
  duo: boolean;
  /** The booster could reveal the login but must start a session first. */
  sessionRequired: boolean;
}

export const DUO_NO_LOGIN_MESSAGE = "Duo orders are played together with you: no account login is shared.";

export function credentialPermissions(
  access: WorkspaceAccess,
  orderStatus: string,
  opts: { duo?: boolean; hasOpenSession?: boolean } = {}
): CredentialPermissions {
  const duo = opts.duo === true;
  const editable = EDITABLE_STATUSES.has(orderStatus);
  const holding = access.activeAssignment;
  const working = access.viewerRole === "booster" && !access.readOnly && holding?.status === "IN_PROGRESS" && orderStatus === "IN_PROGRESS" && !duo;
  return {
    canEdit: access.viewerRole === "customer" && editable && !duo,
    canReveal: working && opts.hasOpenSession === true,
    canDelete: (access.viewerRole === "customer" && editable) || (access.viewerRole === "admin" && editable),
    duo,
    sessionRequired: working && opts.hasOpenSession !== true,
  };
}

export interface CredentialStatusDTO {
  saved: boolean;
  usernameHint: string | null;
  updatedAt: string | null;
  revealCount: number;
  lastRevealedAt: string | null;
}

export async function getCredentialStatus(orderId: string): Promise<CredentialStatusDTO> {
  const row = await prisma.orderAccountCredential.findUnique({
    where: { orderId },
    select: { usernameHint: true, updatedAt: true, revealCount: true, lastRevealedAt: true },
  });
  return {
    saved: !!row,
    usernameHint: row?.usernameHint ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    revealCount: row?.revealCount ?? 0,
    lastRevealedAt: row?.lastRevealedAt?.toISOString() ?? null,
  };
}

function requireConfigured() {
  if (!credentialsConfigured()) {
    throw new CredentialsError("Secure account storage is not configured on the server.", 503);
  }
}

export async function saveCredentials(orderId: string, actorId: string, input: AccountCredentials) {
  requireConfigured();
  const ciphertext = encryptCredentials(orderId, input);
  const usernameHint = maskUsername(input.username);
  const existing = await prisma.orderAccountCredential.findUnique({ where: { orderId }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    // Re-check under the transaction: the order must still be editable.
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, selectedMode: true } });
    if (!order || !EDITABLE_STATUSES.has(order.status)) {
      throw new CredentialsError("This order is finished; account details can no longer be changed.", 409);
    }
    if (order.selectedMode === "duo") throw new CredentialsError(DUO_NO_LOGIN_MESSAGE, 409);
    await tx.orderAccountCredential.upsert({
      where: { orderId },
      create: { orderId, ciphertext, usernameHint, keyVersion: CREDENTIALS_KEY_VERSION, updatedById: actorId },
      // New credentials: reset the reveal history.
      update: { ciphertext, usernameHint, keyVersion: CREDENTIALS_KEY_VERSION, updatedById: actorId, revealCount: 0, lastRevealedAt: null, lastRevealedById: null },
    });
    await recordOrderEvent({
      db: tx,
      orderId,
      type: "ACCOUNT_CREDENTIALS_UPDATED",
      actorUserId: actorId,
      message: existing ? "Account login details replaced" : "Account login details added",
    });
  });
  await signalOrder(orderId, "credentials");
  return getCredentialStatus(orderId);
}

export async function deleteCredentials(orderId: string, actorId: string) {
  const r = await prisma.orderAccountCredential.deleteMany({ where: { orderId } });
  if (r.count > 0) {
    await recordOrderEvent({ orderId, type: "ACCOUNT_CREDENTIALS_REMOVED", actorUserId: actorId, message: "Account login details removed" });
    await signalOrder(orderId, "credentials");
  }
  return { removed: r.count > 0 };
}

/** Booster reveal. Caller must have checked `canReveal`; re-verified here in one transaction. */
export async function revealCredentials(
  orderId: string,
  boosterId: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {}
): Promise<AccountCredentials> {
  requireConfigured();
  const row = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        selectedMode: true,
        assignments: { where: { boosterId, activeOrderId: orderId, status: "IN_PROGRESS" }, select: { id: true } },
      },
    });
    if (!order || order.status !== "IN_PROGRESS" || order.assignments.length === 0) {
      throw new CredentialsError("Account details are only available while you are actively working on this order.", 403);
    }
    if (order.selectedMode === "duo") throw new CredentialsError(DUO_NO_LOGIN_MESSAGE, 403);
    const session = await getOpenSession(orderId, boosterId, tx);
    if (!session) throw new CredentialsError("Start a session (and accept the rules) before viewing the login.", 403);
    await tx.orderCredentialReveal.create({
      data: { orderId, boosterId, sessionId: session.id, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 300) ?? null },
    });
    const cred = await tx.orderAccountCredential.findUnique({ where: { orderId } });
    if (!cred) throw new CredentialsError("The customer has not added account details yet.", 404);
    await tx.orderAccountCredential.update({
      where: { id: cred.id },
      data: { revealCount: { increment: 1 }, lastRevealedAt: new Date(), lastRevealedById: boosterId },
    });
    await recordOrderEvent({
      db: tx,
      orderId,
      type: "ACCOUNT_CREDENTIALS_VIEWED",
      actorUserId: boosterId,
      message: "Booster viewed the account login details",
    });
    return cred;
  });
  return decryptCredentials(orderId, row.ciphertext);
}
