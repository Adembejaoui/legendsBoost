-- Phase 3: order pool with rank ceilings, sealed bidding, claim now,
-- priority and preferred-booster claims, CLAIMED status, SLA warnings.
-- Additive only. New enum values are not USED in this script (PostgreSQL
-- requires ADD VALUE to commit before use), and there are no DO $$ blocks.
-- Existing orders: not priority, bidding round 0, payout = reserved share.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CLAIMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ORDER_OFFERED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BID_WON';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BID_LOST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SLA_WARNING';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'BOOSTER_BID_MARGIN';

CREATE TYPE "OrderBidStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'WON', 'LOST');

ALTER TABLE "order" ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "order" ADD COLUMN "biddingRound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN "biddingClosesAt" TIMESTAMP(3);
ALTER TABLE "order" ADD COLUMN "preferredBoosterId" TEXT;
ALTER TABLE "order" ADD COLUMN "preferredUntil" TIMESTAMP(3);
ALTER TABLE "order" ADD COLUMN "boosterPayoutAmount" INTEGER;
ALTER TABLE "order" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "order" ADD CONSTRAINT "order_bidding_round_check" CHECK ("biddingRound" >= 0);
ALTER TABLE "order" ADD CONSTRAINT "order_booster_payout_check" CHECK ("boosterPayoutAmount" IS NULL OR "boosterPayoutAmount" >= 0);
ALTER TABLE "order" ADD CONSTRAINT "order_preferredBoosterId_fkey" FOREIGN KEY ("preferredBoosterId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "order_status_biddingClosesAt_idx" ON "order"("status", "biddingClosesAt");

ALTER TABLE "orderBoosterAssignment" ADD COLUMN "awardMode" TEXT;
ALTER TABLE "orderBoosterAssignment" ADD COLUMN "payoutAmount" INTEGER;
ALTER TABLE "orderBoosterAssignment" ADD COLUMN "contactWarnedAt" TIMESTAMP(3);
ALTER TABLE "orderBoosterAssignment" ADD COLUMN "startWarnedAt" TIMESTAMP(3);
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_payout_check" CHECK ("payoutAmount" IS NULL OR "payoutAmount" >= 0);

ALTER TABLE "boosterProfile" ADD COLUMN "displayName" TEXT;
CREATE UNIQUE INDEX "boosterProfile_displayName_key" ON "boosterProfile"("displayName");

CREATE TABLE "orderBid" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "OrderBidStatus" NOT NULL DEFAULT 'ACTIVE',
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orderBid_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orderBid_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "orderBid_round_check" CHECK ("round" >= 1)
);
CREATE UNIQUE INDEX "orderBid_orderId_boosterId_round_key" ON "orderBid"("orderId", "boosterId", "round");
CREATE INDEX "orderBid_orderId_round_status_idx" ON "orderBid"("orderId", "round", "status");
CREATE INDEX "orderBid_boosterId_status_idx" ON "orderBid"("boosterId", "status");
ALTER TABLE "orderBid" ADD CONSTRAINT "orderBid_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orderBid" ADD CONSTRAINT "orderBid_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sealed bids: no client access through the Supabase API, server only.
ALTER TABLE "orderBid" ENABLE ROW LEVEL SECURITY;
