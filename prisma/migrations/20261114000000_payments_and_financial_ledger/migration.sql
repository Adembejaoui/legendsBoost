-- Payments, pricing and financial ledger.
--
-- NOT APPLIED. Review, then apply with `prisma migrate deploy` in staging
-- after 20261113000000_order_payment_gate (see
-- docs/STRIPE-STAGING-TEST-PLAN.md). Never `migrate dev` / `reset`.
--
-- Additive only: new enums, new tables, three new nullable columns on
-- "order", six new NotificationType values. No existing row is changed or
-- removed and no existing column, constraint or index is dropped.
--
-- The new NotificationType values are not used anywhere in this script, so
-- adding them inside the migration transaction is safe on PostgreSQL >= 12
-- (Supabase runs 15+).
--
-- Part 1 is generated with
--   prisma migrate diff --from-schema <schema before> --to-schema prisma/schema.prisma --script
-- Part 2 (CHECK constraints, immutability triggers, RLS, default commission
-- policy) is hand-written and cannot be expressed in schema.prisma.

-- ===================================================================== --
-- Part 1: generated DDL                                                  --
-- ===================================================================== --
-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('RANK_STEPS', 'PER_UNIT', 'FIXED');

-- CreateEnum
CREATE TYPE "ServicePriceStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'OPEN', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('CUSTOMER_PAYMENTS', 'PLATFORM_REVENUE', 'BOOSTER_POOL', 'BOOSTER_PAYABLE', 'BOOSTER_PAYOUTS', 'STRIPE_FEES', 'DISPUTE_LOSSES');

-- CreateEnum
CREATE TYPE "FinancialTransactionType" AS ENUM ('CUSTOMER_PAYMENT', 'PLATFORM_COMMISSION', 'BOOSTER_SHARE_RESERVED', 'BOOSTER_EARNING_ALLOCATED', 'REFUND', 'PLATFORM_COMMISSION_REVERSAL', 'BOOSTER_SHARE_REVERSAL', 'STRIPE_FEE', 'DISPUTE_LOSS', 'BOOSTER_PAYOUT');

-- CreateEnum
CREATE TYPE "BoosterEarningStatus" AS ENUM ('RESERVED', 'PENDING_REVIEW', 'PENDING', 'ON_HOLD', 'AVAILABLE', 'IN_PAYOUT', 'PAID', 'REVERSED', 'SPLIT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EARNING_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCE_ALERT';

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "creationIdempotencyKey" TEXT,
ADD COLUMN     "creationRequestHash" TEXT,
ADD COLUMN     "paidPaymentId" TEXT;

-- CreateTable
CREATE TABLE "servicePrice" (
    "id" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "serviceSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ServicePriceStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeKey" TEXT,
    "currency" TEXT NOT NULL,
    "pricingModel" "PricingModel" NOT NULL,
    "baseAmount" INTEGER NOT NULL,
    "stepAmounts" JSONB,
    "unitFieldKey" TEXT,
    "unitAmount" INTEGER,
    "optionPricing" JSONB NOT NULL,
    "modePricing" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "retiredById" TEXT,

    CONSTRAINT "servicePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissionPolicy" (
    "id" TEXT NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "boosterShareBps" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orderPricingSnapshot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "commissionBaseAmount" INTEGER NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "boosterShareBps" INTEGER NOT NULL,
    "platformFeeAmount" INTEGER NOT NULL,
    "boosterShareAmount" INTEGER NOT NULL,
    "commissionPolicyId" TEXT NOT NULL,
    "servicePriceId" TEXT NOT NULL,
    "servicePriceVersion" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orderPricingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STRIPE',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "attemptNumber" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "openSlotOrderId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "checkoutUrl" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3),
    "amountReceived" INTEGER,
    "amountRefunded" INTEGER NOT NULL DEFAULT 0,
    "stripeFeeAmount" INTEGER,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "lastFailedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STRIPE',
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "lastError" TEXT,
    "paymentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "paymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financialTransaction" (
    "id" TEXT NOT NULL,
    "type" "FinancialTransactionType" NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "orderId" TEXT,
    "boosterId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "disputeId" TEXT,
    "payoutId" TEXT,
    "earningId" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boosterEarning" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "boosterId" TEXT,
    "assignmentId" TEXT,
    "parentEarningId" TEXT,
    "reservationKey" TEXT,
    "grossAmount" INTEGER NOT NULL,
    "reversedAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "boosterShareBps" INTEGER NOT NULL,
    "status" "BoosterEarningStatus" NOT NULL,
    "holdReason" TEXT,
    "allocationNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boosterEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boosterPayout" (
    "id" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "openKey" TEXT,
    "method" TEXT,
    "externalReference" TEXT,
    "evidence" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "processingAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidRecordedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boosterPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "stripeRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "initiatedById" TEXT,
    "failureReason" TEXT,
    "platformReversalAmount" INTEGER,
    "boosterReversalAmount" INTEGER,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT,
    "stripeStatus" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "evidenceDueBy" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "lossPostedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "outboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financialAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financialAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "servicePrice_activeKey_key" ON "servicePrice"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "servicePrice_gameSlug_serviceSlug_version_key" ON "servicePrice"("gameSlug", "serviceSlug", "version");

-- CreateIndex
CREATE INDEX "commissionPolicy_effectiveFrom_idx" ON "commissionPolicy"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "orderPricingSnapshot_orderId_key" ON "orderPricingSnapshot"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotencyKey_key" ON "payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_openSlotOrderId_key" ON "payment"("openSlotOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_stripeCheckoutSessionId_key" ON "payment"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_stripePaymentIntentId_key" ON "payment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_stripeChargeId_key" ON "payment"("stripeChargeId");

-- CreateIndex
CREATE INDEX "payment_orderId_idx" ON "payment"("orderId");

-- CreateIndex
CREATE INDEX "payment_status_idx" ON "payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orderId_attemptNumber_key" ON "payment"("orderId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "paymentEvent_stripeEventId_key" ON "paymentEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "paymentEvent_status_idx" ON "paymentEvent"("status");

-- CreateIndex
CREATE INDEX "paymentEvent_type_idx" ON "paymentEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "financialTransaction_idempotencyKey_key" ON "financialTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "financialTransaction_orderId_idx" ON "financialTransaction"("orderId");

-- CreateIndex
CREATE INDEX "financialTransaction_boosterId_idx" ON "financialTransaction"("boosterId");

-- CreateIndex
CREATE INDEX "financialTransaction_account_idx" ON "financialTransaction"("account");

-- CreateIndex
CREATE INDEX "financialTransaction_createdAt_idx" ON "financialTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "boosterEarning_reservationKey_key" ON "boosterEarning"("reservationKey");

-- CreateIndex
CREATE INDEX "boosterEarning_orderId_idx" ON "boosterEarning"("orderId");

-- CreateIndex
CREATE INDEX "boosterEarning_boosterId_status_idx" ON "boosterEarning"("boosterId", "status");

-- CreateIndex
CREATE INDEX "boosterEarning_payoutId_idx" ON "boosterEarning"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "boosterPayout_openKey_key" ON "boosterPayout"("openKey");

-- CreateIndex
CREATE INDEX "boosterPayout_boosterId_status_idx" ON "boosterPayout"("boosterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "boosterPayout_method_externalReference_key" ON "boosterPayout"("method", "externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "refund_stripeRefundId_key" ON "refund"("stripeRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_idempotencyKey_key" ON "refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "refund_orderId_idx" ON "refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_stripeDisputeId_key" ON "dispute"("stripeDisputeId");

-- CreateIndex
CREATE INDEX "dispute_orderId_idx" ON "dispute"("orderId");

-- CreateIndex
CREATE INDEX "dispute_status_idx" ON "dispute"("status");

-- CreateIndex
CREATE UNIQUE INDEX "outboxEvent_dedupeKey_key" ON "outboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "outboxEvent_status_availableAt_idx" ON "outboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "financialAuditLog_entityType_entityId_idx" ON "financialAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "financialAuditLog_createdAt_idx" ON "financialAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_paidPaymentId_key" ON "order"("paidPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "order_userId_creationIdempotencyKey_key" ON "order"("userId", "creationIdempotencyKey");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_paidPaymentId_fkey" FOREIGN KEY ("paidPaymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderPricingSnapshot" ADD CONSTRAINT "orderPricingSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderPricingSnapshot" ADD CONSTRAINT "orderPricingSnapshot_commissionPolicyId_fkey" FOREIGN KEY ("commissionPolicyId") REFERENCES "commissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderPricingSnapshot" ADD CONSTRAINT "orderPricingSnapshot_servicePriceId_fkey" FOREIGN KEY ("servicePriceId") REFERENCES "servicePrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentEvent" ADD CONSTRAINT "paymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financialTransaction" ADD CONSTRAINT "financialTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financialTransaction" ADD CONSTRAINT "financialTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterEarning" ADD CONSTRAINT "boosterEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterEarning" ADD CONSTRAINT "boosterEarning_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterEarning" ADD CONSTRAINT "boosterEarning_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "orderBoosterAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterEarning" ADD CONSTRAINT "boosterEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "boosterPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterPayout" ADD CONSTRAINT "boosterPayout_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================================================================== --
-- Part 2: integrity rules not expressible in schema.prisma               --
-- ===================================================================== --

-- Money is integer minor units, never negative where a negative amount has
-- no meaning, and always carries an ISO-4217 upper-case currency code.
ALTER TABLE "servicePrice"
  ADD CONSTRAINT "servicePrice_amounts_check" CHECK ("baseAmount" >= 0 AND ("unitAmount" IS NULL OR "unitAmount" >= 0) AND "version" >= 1),
  ADD CONSTRAINT "servicePrice_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "commissionPolicy"
  ADD CONSTRAINT "commissionPolicy_bps_check" CHECK (
    "platformFeeBps" >= 0 AND "boosterShareBps" >= 0 AND "platformFeeBps" + "boosterShareBps" = 10000
  );

ALTER TABLE "orderPricingSnapshot"
  ADD CONSTRAINT "orderPricingSnapshot_amounts_check" CHECK (
    "subtotalAmount" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" > 0
    AND "commissionBaseAmount" = "subtotalAmount" - "discountAmount"
    AND "totalAmount" = "commissionBaseAmount" + "taxAmount"
    AND "platformFeeAmount" >= 0 AND "boosterShareAmount" >= 0
    AND "platformFeeAmount" + "boosterShareAmount" = "commissionBaseAmount"
    AND "platformFeeBps" + "boosterShareBps" = 10000
  ),
  ADD CONSTRAINT "orderPricingSnapshot_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amounts_check" CHECK (
    "amount" > 0 AND "amountRefunded" >= 0
    AND ("amountReceived" IS NULL OR "amountReceived" >= 0)
    AND "amountRefunded" <= COALESCE("amountReceived", "amount")
    AND ("stripeFeeAmount" IS NULL OR "stripeFeeAmount" >= 0)
  ),
  ADD CONSTRAINT "payment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- The open slot is only held by attempts that are still open.
  ADD CONSTRAINT "payment_open_slot_check" CHECK (
    ("openSlotOrderId" IS NULL) OR ("openSlotOrderId" = "orderId" AND "status" IN ('CREATED', 'OPEN', 'PROCESSING'))
  );

ALTER TABLE "financialTransaction"
  ADD CONSTRAINT "financialTransaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "financialTransaction_nonzero_check" CHECK ("amount" <> 0),
  ADD CONSTRAINT "financialTransaction_booster_check" CHECK (("account" <> 'BOOSTER_PAYABLE') OR ("boosterId" IS NOT NULL));

ALTER TABLE "boosterEarning"
  ADD CONSTRAINT "boosterEarning_amounts_check" CHECK ("grossAmount" >= 0 AND "reversedAmount" >= 0 AND "reversedAmount" <= "grossAmount"),
  ADD CONSTRAINT "boosterEarning_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "boosterEarning_booster_check" CHECK (
    "status" IN ('RESERVED', 'PENDING_REVIEW', 'SPLIT', 'REVERSED') OR "boosterId" IS NOT NULL
  );

ALTER TABLE "boosterPayout"
  ADD CONSTRAINT "boosterPayout_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "boosterPayout_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "boosterPayout_open_key_check" CHECK (
    ("openKey" IS NULL) OR ("status" IN ('REQUESTED', 'APPROVED', 'PROCESSING'))
  ),
  -- A payout can only be PAID with an external reference and evidence.
  ADD CONSTRAINT "boosterPayout_paid_evidence_check" CHECK (
    "status" <> 'PAID' OR (
      "paidAt" IS NOT NULL AND "paidRecordedById" IS NOT NULL
      AND COALESCE(length(trim("method")), 0) > 0
      AND COALESCE(length(trim("externalReference")), 0) > 0
      AND COALESCE(length(trim("evidence")), 0) > 0
    )
  );

ALTER TABLE "refund"
  ADD CONSTRAINT "refund_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "refund_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "dispute"
  ADD CONSTRAINT "dispute_amount_check" CHECK ("amount" >= 0),
  ADD CONSTRAINT "dispute_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- Append-only tables: the ledger, the price snapshots and the audit log can
-- never be updated or deleted, not even by the application role.
CREATE OR REPLACE FUNCTION "legendsboost_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table "%" is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "financialTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "financialTransaction"
  FOR EACH ROW EXECUTE FUNCTION "legendsboost_reject_mutation"();
CREATE TRIGGER "financialTransaction_no_truncate"
  BEFORE TRUNCATE ON "financialTransaction"
  FOR EACH STATEMENT EXECUTE FUNCTION "legendsboost_reject_mutation"();

CREATE TRIGGER "orderPricingSnapshot_append_only"
  BEFORE UPDATE OR DELETE ON "orderPricingSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "legendsboost_reject_mutation"();

CREATE TRIGGER "financialAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "financialAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "legendsboost_reject_mutation"();

-- Server-only tables: Prisma connects with the database owner role; the
-- Supabase anon/authenticated roles get no policies, so PostgREST exposes
-- nothing from these tables.
ALTER TABLE "servicePrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commissionPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orderPricingSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paymentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financialTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boosterEarning" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boosterPayout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dispute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financialAuditLog" ENABLE ROW LEVEL SECURITY;

-- Confirmed business rule: 45% platform commission / 55% booster share.
-- Later changes are new rows (admin finance settings), never updates.
INSERT INTO "commissionPolicy" ("id", "platformFeeBps", "boosterShareBps", "effectiveFrom", "note", "createdAt")
VALUES ('commission_policy_initial_45_55', 4500, 5500, TIMESTAMP '2026-01-01 00:00:00', 'Initial policy: 45% platform / 55% booster', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
