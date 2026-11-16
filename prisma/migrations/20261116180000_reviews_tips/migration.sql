-- Phase 8: customer reviews (one per completed order, booster reply, admin
-- hide) and tips (Stripe Checkout, split like an order).
-- Additive only. New enum values are not USED in this script.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REVIEW_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TIP_RECEIVED';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'TIP_PAYMENT';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'TIP_COMMISSION';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'TIP_BOOSTER_SHARE';

CREATE TYPE "OrderTipStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');

CREATE TABLE "orderReview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orderReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orderReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "orderReview_orderId_key" ON "orderReview"("orderId");
CREATE INDEX "orderReview_boosterId_createdAt_idx" ON "orderReview"("boosterId", "createdAt");
ALTER TABLE "orderReview" ADD CONSTRAINT "orderReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orderReview" ADD CONSTRAINT "orderReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orderReview" ADD CONSTRAINT "orderReview_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "orderTip" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "platformFeeAmount" INTEGER NOT NULL,
    "boosterAmount" INTEGER NOT NULL,
    "status" "OrderTipStatus" NOT NULL DEFAULT 'PENDING',
    "stripeSessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orderTip_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orderTip_amount_check" CHECK ("amount" > 0 AND "platformFeeAmount" >= 0 AND "boosterAmount" >= 0 AND "platformFeeAmount" + "boosterAmount" = "amount"),
    CONSTRAINT "orderTip_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "orderTip_stripeSessionId_key" ON "orderTip"("stripeSessionId");
CREATE UNIQUE INDEX "orderTip_idempotencyKey_key" ON "orderTip"("idempotencyKey");
CREATE INDEX "orderTip_orderId_idx" ON "orderTip"("orderId");
CREATE INDEX "orderTip_boosterId_status_idx" ON "orderTip"("boosterId", "status");
ALTER TABLE "orderTip" ADD CONSTRAINT "orderTip_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orderReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orderTip" ENABLE ROW LEVEL SECURITY;
