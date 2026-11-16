// Server-only module.
/**
 * Booster payout methods (Phase 7, decisions 2026-11-16).
 *
 *  - One method per booster: PayPal email, IBAN (+ account holder) or a crypto
 *    address (USDT TRC20 / ERC20, BTC). Stored encrypted (AES-256-GCM, context
 *    "payout-method:<boosterId>"); only a masked hint is kept in clear.
 *  - Replacing the method locks payouts for payout_method_cooldown_hours (48)
 *    and sends the booster a security notification (account takeover guard).
 *  - A payout copies the method at request time; admins reveal that copy to
 *    pay it (audited, counted).
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getConfig } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/security/account-credentials";
import { writeAudit } from "./audit";
import { createNotification } from "@/lib/notifications/service";
import { hasBoosterAccess } from "@/lib/boosters/status";

export class PayoutMethodError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PayoutMethodError";
  }
}

export const methodContext = (boosterId: string) => `payout-method:${boosterId}`;

/** IBAN checksum (ISO 13616 mod 97). Input without spaces, upper case. */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

const CRYPTO_ADDRESS: Record<string, RegExp> = {
  USDT_TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  USDT_ERC20: /^0x[a-fA-F0-9]{40}$/,
  BTC: /^(bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
};

export const payoutMethodSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PAYPAL"), email: z.string().trim().toLowerCase().email("Enter your PayPal email").max(200) }).strict(),
  z
    .object({
      type: z.literal("IBAN"),
      holder: z.string().trim().min(2, "Enter the account holder name").max(120),
      iban: z
        .string()
        .transform((v) => v.replace(/\s+/g, "").toUpperCase())
        .refine(isValidIban, "This IBAN is not valid"),
    })
    .strict(),
  z
    .object({
      type: z.literal("CRYPTO"),
      network: z.enum(["USDT_TRC20", "USDT_ERC20", "BTC"]),
      address: z.string().trim().max(120),
    })
    .strict()
    .refine((v) => CRYPTO_ADDRESS[v.network].test(v.address), { message: "This address does not match the network", path: ["address"] }),
]);
export type PayoutMethodInput = z.infer<typeof payoutMethodSchema>;

export function methodHint(m: PayoutMethodInput): string {
  if (m.type === "PAYPAL") {
    const [user, domain] = m.email.split("@");
    return `PayPal ${user.slice(0, 2)}•••@${domain}`;
  }
  if (m.type === "IBAN") return `IBAN ${m.iban.slice(0, 4)} •••• ${m.iban.slice(-4)}`;
  return `${m.network.replace("_", " ")} ${m.address.slice(0, 4)}…${m.address.slice(-4)}`;
}

export interface PayoutMethodStatus {
  type: string;
  hint: string;
  setAt: string;
  /** Payouts are locked until then (after a change), else null. */
  lockedUntil: string | null;
}

export async function getPayoutMethodStatus(boosterId: string, now = new Date()): Promise<PayoutMethodStatus | null> {
  const m = await prisma.boosterPayoutMethod.findUnique({ where: { boosterId } });
  if (!m) return null;
  const hours = await getConfig("payout_method_cooldown_hours");
  const until = new Date(m.setAt.getTime() + hours * 3_600_000);
  return { type: m.type, hint: m.hint, setAt: m.setAt.toISOString(), lockedUntil: m.replaced && until > now ? until.toISOString() : null };
}

export async function setPayoutMethod(boosterId: string, raw: unknown) {
  const user = await prisma.user.findUnique({ where: { id: boosterId }, include: { boosterProfile: { select: { verificationStatus: true } } } });
  if (!user || user.role !== "BOOSTER" || !hasBoosterAccess(user.boosterProfile?.verificationStatus)) {
    throw new PayoutMethodError("Only active boosters can set a payout method.", 403);
  }
  const parsed = payoutMethodSchema.safeParse(raw);
  if (!parsed.success) throw new PayoutMethodError(parsed.error.issues[0]?.message ?? "Invalid payout method", 400);
  const method = parsed.data;
  const ciphertext = encryptSecret(methodContext(boosterId), JSON.stringify(method));
  const hint = methodHint(method);

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.boosterPayoutMethod.findUnique({ where: { boosterId }, select: { id: true } });
    const row = await tx.boosterPayoutMethod.upsert({
      where: { boosterId },
      create: { boosterId, type: method.type, ciphertext, hint, setAt: new Date(), replaced: false },
      update: { type: method.type, ciphertext, hint, setAt: new Date(), replaced: true },
    });
    await writeAudit(tx, { actorId: boosterId, action: existing ? "PAYOUT_METHOD_CHANGED" : "PAYOUT_METHOD_ADDED", entityType: "boosterPayoutMethod", entityId: row.id, details: { type: method.type, hint } });
    return { row, replaced: !!existing };
  });
  if (saved.replaced) {
    // Security alert: if this was not the booster, they can react before the lock ends.
    await createNotification(boosterId, "PAYOUT_METHOD_CHANGED", undefined, { hint }, "system", { includeActor: true, dedupeKey: `payout-method:${saved.row.setAt.toISOString()}` }).catch(() => {});
  }
  return getPayoutMethodStatus(boosterId);
}

/** Copy of the method for a payout being created (inside the payout transaction). */
export async function payoutMethodSnapshot(boosterId: string, now = new Date()) {
  const m = await prisma.boosterPayoutMethod.findUnique({ where: { boosterId } });
  if (!m) throw new PayoutMethodError("Add a payout method before requesting a payout.", 409);
  const hours = await getConfig("payout_method_cooldown_hours");
  const until = new Date(m.setAt.getTime() + hours * 3_600_000);
  if (m.replaced && until > now) {
    throw new PayoutMethodError(`Your payout method was changed recently. Payouts are available again after ${until.toISOString().slice(0, 16).replace("T", " ")} UTC.`, 409);
  }
  return { methodType: m.type, methodHint: m.hint, methodCiphertext: m.ciphertext };
}

/** Admin: read the payout details copied on a payout, to pay it. Audited. */
export async function revealPayoutMethod(adminId: string, payoutId: string): Promise<PayoutMethodInput> {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  if (!admin || admin.role !== "ADMIN") throw new PayoutMethodError("Only administrators can view payout details.", 403);
  const payout = await prisma.boosterPayout.findUnique({ where: { id: payoutId }, select: { id: true, boosterId: true, methodCiphertext: true, status: true } });
  if (!payout?.methodCiphertext) throw new PayoutMethodError("This payout has no payout details.", 404);
  const details = JSON.parse(decryptSecret(methodContext(payout.boosterId), payout.methodCiphertext)) as PayoutMethodInput;
  await prisma.$transaction(async (tx) => {
    await tx.boosterPayout.update({ where: { id: payout.id }, data: { methodRevealCount: { increment: 1 } } });
    await writeAudit(tx, { actorId: adminId, action: "PAYOUT_METHOD_REVEALED", entityType: "boosterPayout", entityId: payout.id, details: { status: payout.status } });
  });
  return details;
}
