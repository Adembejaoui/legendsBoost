/**
 * Admin management of service prices and the commission policy.
 *
 * Both are append-only: a price change creates version N+1 and retires
 * version N in one transaction; a commission change inserts a new policy.
 * Existing orders keep their own snapshot and are never re-priced.
 */
import prisma from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { BPS_DENOMINATOR, normalizeCurrency } from "@/lib/money";
import { servicePriceInputSchema, validateServicePriceAgainstCatalog, type ServicePriceInput } from "./price-config";
import { writeAudit } from "@/lib/finance/audit";

export class PricingAdminError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: string[]) {
    super(message);
    this.name = "PricingAdminError";
  }
}

async function assertAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u || u.role !== "ADMIN") throw new PricingAdminError("Only administrators can manage pricing.", 403);
}

export async function createServicePriceVersion(adminId: string, raw: unknown) {
  await assertAdmin(adminId);
  const parsed = servicePriceInputSchema.safeParse(raw);
  if (!parsed.success) throw new PricingAdminError(parsed.error.issues[0]?.message ?? "Invalid price", 400);
  const input: ServicePriceInput = { ...parsed.data, currency: parsed.data.currency.toUpperCase() };
  const errors = validateServicePriceAgainstCatalog(input);
  if (errors.length) throw new PricingAdminError(errors[0], 400, errors);
  const currency = normalizeCurrency(input.currency);
  const activeKey = `${input.gameSlug}:${input.serviceSlug}`;

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.servicePrice.findFirst({
        where: { gameSlug: input.gameSlug, serviceSlug: input.serviceSlug },
        orderBy: { version: "desc" },
      });
      const previousActive = await tx.servicePrice.findUnique({ where: { activeKey } });
      if (previousActive) {
        await tx.servicePrice.update({
          where: { id: previousActive.id, activeKey },
          data: { status: "RETIRED", activeKey: null, retiredAt: new Date(), retiredById: adminId },
        });
      }
      const created = await tx.servicePrice.create({
        data: {
          gameSlug: input.gameSlug,
          serviceSlug: input.serviceSlug,
          version: (latest?.version ?? 0) + 1,
          status: "ACTIVE",
          activeKey,
          currency,
          pricingModel: input.pricingModel,
          baseAmount: input.baseAmount,
          stepAmounts: (input.stepAmounts ?? Prisma.DbNull) as Prisma.InputJsonValue,
          unitFieldKey: input.unitFieldKey ?? null,
          unitAmount: input.unitAmount ?? null,
          optionPricing: input.optionPricing as Prisma.InputJsonValue,
          modePricing: input.modePricing as Prisma.InputJsonValue,
          createdById: adminId,
        },
      });
      await writeAudit(tx, {
        actorId: adminId,
        action: "SERVICE_PRICE_CREATED",
        entityType: "servicePrice",
        entityId: created.id,
        details: { version: created.version, retiredId: previousActive?.id ?? null, input },
      });
      return created;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002" || (e as { code?: string }).code === "P2025") {
      throw new PricingAdminError("The price was changed concurrently. Reload and try again.", 409);
    }
    throw e;
  }
}

/** Retire the active price: the service becomes unpurchasable. */
export async function retireServicePrice(adminId: string, priceId: string) {
  await assertAdmin(adminId);
  return prisma.$transaction(async (tx) => {
    const price = await tx.servicePrice.findUnique({ where: { id: priceId } });
    if (!price) throw new PricingAdminError("Price not found.", 404);
    if (price.status !== "ACTIVE") throw new PricingAdminError("This price is already retired.", 409);
    const updated = await tx.servicePrice.update({
      where: { id: priceId, status: "ACTIVE" },
      data: { status: "RETIRED", activeKey: null, retiredAt: new Date(), retiredById: adminId },
    });
    await writeAudit(tx, { actorId: adminId, action: "SERVICE_PRICE_RETIRED", entityType: "servicePrice", entityId: priceId });
    return updated;
  });
}

/**
 * New commission policy for FUTURE orders. platformFeeBps + boosterShareBps
 * is always 100%. effectiveFrom defaults to now and may not be in the past
 * (history is never rewritten).
 */
export async function createCommissionPolicy(
  adminId: string,
  input: { platformFeeBps: number; effectiveFrom?: Date; note?: string }
) {
  await assertAdmin(adminId);
  const fee = input.platformFeeBps;
  if (!Number.isInteger(fee) || fee < 0 || fee > BPS_DENOMINATOR) {
    throw new PricingAdminError("Commission must be between 0 and 10000 basis points.", 400);
  }
  const effectiveFrom = input.effectiveFrom ?? new Date();
  if (effectiveFrom.getTime() < Date.now() - 60_000) {
    throw new PricingAdminError("A commission change cannot take effect in the past.", 400);
  }
  const note = input.note?.trim().slice(0, 500) || null;
  return prisma.$transaction(async (tx) => {
    const policy = await tx.commissionPolicy.create({
      data: { platformFeeBps: fee, boosterShareBps: BPS_DENOMINATOR - fee, effectiveFrom, createdById: adminId, note },
    });
    await writeAudit(tx, {
      actorId: adminId,
      action: "COMMISSION_POLICY_CREATED",
      entityType: "commissionPolicy",
      entityId: policy.id,
      details: { platformFeeBps: fee, boosterShareBps: BPS_DENOMINATOR - fee, effectiveFrom: effectiveFrom.toISOString(), note },
    });
    return policy;
  });
}
