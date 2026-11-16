-- Phase 1: coupons, risk-disclosure consent on orders, customer cancellation
-- requests. Additive only: no existing row is changed. RLS enabled with no
-- policies on the new tables (server-only access).
-- NOT APPLIED. Apply with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "CancellationRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- Order: risk disclosure consent
ALTER TABLE "order" ADD COLUMN "riskDisclosureAcceptedAt" TIMESTAMP(3);
ALTER TABLE "order" ADD COLUMN "riskDisclosureVersion" TEXT;

-- Coupons
CREATE TABLE "coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "percentBps" INTEGER,
    "amount" INTEGER,
    "currency" TEXT,
    "maxDiscount" INTEGER,
    "minSubtotal" INTEGER,
    "maxRedemptions" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "gameSlug" TEXT,
    "serviceSlug" TEXT,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "coupon_pkey" PRIMARY KEY ("id"),
    -- Exactly one amount per type, in sane ranges.
    CONSTRAINT "coupon_shape_check" CHECK (
      ("type" = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "amount" IS NULL)
      OR ("type" = 'FIXED' AND "amount" > 0 AND "currency" IS NOT NULL AND "percentBps" IS NULL)
    ),
    CONSTRAINT "coupon_code_upper_check" CHECK ("code" = upper("code"))
);
CREATE UNIQUE INDEX "coupon_code_key" ON "coupon"("code");

ALTER TABLE "orderPricingSnapshot" ADD COLUMN "couponId" TEXT;
ALTER TABLE "orderPricingSnapshot" ADD COLUMN "couponCode" TEXT;
CREATE INDEX "orderPricingSnapshot_couponId_idx" ON "orderPricingSnapshot"("couponId");
ALTER TABLE "orderPricingSnapshot" ADD CONSTRAINT "orderPricingSnapshot_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cancellation requests
CREATE TABLE "orderCancellationRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "adminNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "refundAmount" INTEGER,
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orderCancellationRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orderCancellationRequest_refund_check" CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0)
);
CREATE INDEX "orderCancellationRequest_orderId_idx" ON "orderCancellationRequest"("orderId");
CREATE INDEX "orderCancellationRequest_status_createdAt_idx" ON "orderCancellationRequest"("status", "createdAt");
-- At most one open request per order.
CREATE UNIQUE INDEX "orderCancellationRequest_one_open_per_order" ON "orderCancellationRequest"("orderId") WHERE "status" = 'REQUESTED';
ALTER TABLE "orderCancellationRequest" ADD CONSTRAINT "orderCancellationRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orderCancellationRequest" ENABLE ROW LEVEL SECURITY;
