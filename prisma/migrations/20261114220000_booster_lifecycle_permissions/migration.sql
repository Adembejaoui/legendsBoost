-- Phase 2: booster lifecycle states, trial, rules/KYC fields, per-game
-- permissions with a rank ceiling, booster event history.
-- Additive only. New enum values are not USED in this script (PostgreSQL
-- requires ADD VALUE to commit before use), and there are no DO $$ blocks.
-- Existing boosters keep their status; their ceilings are filled by
-- scripts/backfill-booster-permissions.ts (from their application peak rank).
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "BoosterVerificationStatus" ADD VALUE IF NOT EXISTS 'NEEDS_INFO';
ALTER TYPE "BoosterVerificationStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "BoosterVerificationStatus" ADD VALUE IF NOT EXISTS 'TRIAL';
ALTER TYPE "BoosterVerificationStatus" ADD VALUE IF NOT EXISTS 'ON_BREAK';
ALTER TYPE "BoosterVerificationStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

ALTER TABLE "boosterProfile" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "boosterProfile" ADD COLUMN "trialOrdersRemaining" INTEGER;
ALTER TABLE "boosterProfile" ADD COLUMN "rulesVersion" TEXT;
ALTER TABLE "boosterProfile" ADD COLUMN "rulesAcceptedAt" TIMESTAMP(3);
ALTER TABLE "boosterProfile" ADD COLUMN "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "boosterProfile" ADD COLUMN "kycReference" TEXT;
ALTER TABLE "boosterProfile" ADD COLUMN "maxConcurrentOrders" INTEGER;
ALTER TABLE "boosterProfile" ADD CONSTRAINT "boosterProfile_trial_orders_check" CHECK ("trialOrdersRemaining" IS NULL OR "trialOrdersRemaining" >= 0);
ALTER TABLE "boosterProfile" ADD CONSTRAINT "boosterProfile_max_concurrent_check" CHECK ("maxConcurrentOrders" IS NULL OR "maxConcurrentOrders" BETWEEN 1 AND 20);

CREATE TABLE "boosterPermission" (
    "id" TEXT NOT NULL,
    "boosterProfileId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "rankSystemId" TEXT NOT NULL,
    "maxTargetRankValue" INTEGER NOT NULL,
    "maxTargetTierId" TEXT NOT NULL,
    "maxTargetDivisionId" TEXT,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serviceSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boosterPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "boosterPermission_value_check" CHECK ("maxTargetRankValue" >= 0)
);
CREATE UNIQUE INDEX "boosterPermission_boosterProfileId_gameSlug_key" ON "boosterPermission"("boosterProfileId", "gameSlug");
ALTER TABLE "boosterPermission" ADD CONSTRAINT "boosterPermission_boosterProfileId_fkey" FOREIGN KEY ("boosterProfileId") REFERENCES "boosterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "boosterEvent" (
    "id" TEXT NOT NULL,
    "boosterProfileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "boosterEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "boosterEvent_boosterProfileId_createdAt_idx" ON "boosterEvent"("boosterProfileId", "createdAt");
ALTER TABLE "boosterEvent" ADD CONSTRAINT "boosterEvent_boosterProfileId_fkey" FOREIGN KEY ("boosterProfileId") REFERENCES "boosterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "boosterPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boosterEvent" ENABLE ROW LEVEL SECURITY;
