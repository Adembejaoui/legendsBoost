// Server-only module.
/**
 * Admin management of discount codes. Every change is audited. Codes are
 * never deleted (orders reference them); they are deactivated instead.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizeCurrency, parseDecimalToMinor } from "@/lib/money";
import { gameServices } from "@/lib/catalog/game-services";
import { PricingAdminError } from "./admin.service";
import { normalizeCouponCode } from "./coupons";

const decimal = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Use an amount like 10 or 9.99");

export const couponInputSchema = z
  .object({
    code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
    type: z.enum(["PERCENT", "FIXED"]),
    /** PERCENT: 1-100 (decimals allowed, e.g. 12.5). */
    percent: z.number().positive().max(100).optional(),
    /** FIXED: decimal amount in `currency`. */
    amount: decimal.optional(),
    currency: z.string().length(3).default("USD"),
    maxDiscount: decimal.optional(),
    minSubtotal: decimal.optional(),
    maxRedemptions: z.number().int().positive().optional(),
    perCustomerLimit: z.number().int().positive().max(100).default(1),
    gameSlug: z.string().max(64).optional(),
    serviceSlug: z.string().max(64).optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export type CouponInput = z.input<typeof couponInputSchema>;

export async function createCoupon(adminId: string, raw: unknown) {
  const parsed = couponInputSchema.safeParse(raw);
  if (!parsed.success) throw new PricingAdminError(parsed.error.issues[0]?.message ?? "Invalid coupon", 400);
  const i = parsed.data;
  const currency = normalizeCurrency(i.currency);
  const code = normalizeCouponCode(i.code);

  if (i.type === "PERCENT" && !i.percent) throw new PricingAdminError("A percent coupon needs a percentage.", 400);
  if (i.type === "FIXED" && !i.amount) throw new PricingAdminError("A fixed coupon needs an amount.", 400);
  if (i.startsAt && i.expiresAt && i.expiresAt <= i.startsAt) throw new PricingAdminError("The end date must be after the start date.", 400);
  if (i.gameSlug && !gameServices.some((s) => s.gameSlug === i.gameSlug)) throw new PricingAdminError("Unknown game.", 400);
  if (i.serviceSlug && !gameServices.some((s) => s.serviceSlug === i.serviceSlug && (!i.gameSlug || s.gameSlug === i.gameSlug))) {
    throw new PricingAdminError("Unknown service.", 400);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.create({
        data: {
          code,
          type: i.type,
          percentBps: i.type === "PERCENT" ? Math.round(i.percent! * 100) : null,
          amount: i.type === "FIXED" ? parseDecimalToMinor(i.amount!, currency) : null,
          currency: i.type === "FIXED" ? currency : null,
          maxDiscount: i.maxDiscount ? parseDecimalToMinor(i.maxDiscount, currency) : null,
          minSubtotal: i.minSubtotal ? parseDecimalToMinor(i.minSubtotal, currency) : null,
          maxRedemptions: i.maxRedemptions ?? null,
          perCustomerLimit: i.perCustomerLimit,
          gameSlug: i.gameSlug || null,
          serviceSlug: i.serviceSlug || null,
          startsAt: i.startsAt ?? null,
          expiresAt: i.expiresAt ?? null,
          note: i.note ?? null,
          createdById: adminId,
        },
      });
      await audit({ actorId: adminId, action: "COUPON_CREATED", entityType: "coupon", entityId: coupon.id, metadata: { code, type: i.type } }, tx);
      return coupon;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new PricingAdminError(`The code ${code} already exists.`, 409);
    throw e;
  }
}

export async function setCouponActive(adminId: string, couponId: string, active: boolean) {
  return prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.update({ where: { id: couponId }, data: { active } });
    await audit({ actorId: adminId, action: active ? "COUPON_ACTIVATED" : "COUPON_DEACTIVATED", entityType: "coupon", entityId: couponId, metadata: { code: coupon.code } }, tx);
    return coupon;
  });
}

/** Coupons with their use counts (paid orders, and orders still in checkout). */
export async function listCouponsWithUsage() {
  const coupons = await prisma.coupon.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
  const counts = await Promise.all(
    coupons.map((c) =>
      Promise.all([
        prisma.orderPricingSnapshot.count({ where: { couponId: c.id, order: { paymentVerifiedAt: { not: null } } } }),
        prisma.orderPricingSnapshot.aggregate({ where: { couponId: c.id, order: { paymentVerifiedAt: { not: null } } }, _sum: { discountAmount: true } }),
      ])
    )
  );
  return coupons.map((c, i) => ({ ...c, paidUses: counts[i][0], totalDiscount: counts[i][1]._sum.discountAmount ?? 0 }));
}
