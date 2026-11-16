-- Phase 6: strikes, admin fines (with appeals and ledger entries), fines
-- deducted from payouts, inactivity warnings.
-- Additive only. New enum values are not USED in this script.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STRIKE_ADDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINE_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINE_APPEAL_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INACTIVITY_WARNING';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'BOOSTER_FINE';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'BOOSTER_FINE_REVERSAL';

CREATE TYPE "BoosterFineStatus" AS ENUM ('ISSUED', 'APPEALED', 'UPHELD', 'REVERSED');

ALTER TABLE "orderBoosterAssignment" ADD COLUMN "inactivityWarnedAt" TIMESTAMP(3);
ALTER TABLE "boosterPayout" ADD COLUMN "finesDeducted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "boosterPayout" ADD CONSTRAINT "boosterPayout_fines_check" CHECK ("finesDeducted" >= 0);

CREATE TABLE "boosterFine" (
    "id" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "BoosterFineStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedById" TEXT NOT NULL,
    "appealText" TEXT,
    "appealedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "deductedPayoutId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boosterFine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "boosterFine_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "boosterFine_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE INDEX "boosterFine_boosterId_status_idx" ON "boosterFine"("boosterId", "status");
CREATE INDEX "boosterFine_status_appealedAt_idx" ON "boosterFine"("status", "appealedAt");
ALTER TABLE "boosterFine" ADD CONSTRAINT "boosterFine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boosterFine" ADD CONSTRAINT "boosterFine_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boosterFine" ADD CONSTRAINT "boosterFine_deductedPayoutId_fkey" FOREIGN KEY ("deductedPayoutId") REFERENCES "boosterPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "boosterStrike" (
    "id" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "orderId" TEXT,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "fineId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removeReason" TEXT,
    CONSTRAINT "boosterStrike_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "boosterStrike_fineId_key" ON "boosterStrike"("fineId");
CREATE INDEX "boosterStrike_boosterId_createdAt_idx" ON "boosterStrike"("boosterId", "createdAt");
ALTER TABLE "boosterStrike" ADD CONSTRAINT "boosterStrike_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boosterStrike" ADD CONSTRAINT "boosterStrike_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "boosterFine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boosterStrike" ADD CONSTRAINT "boosterStrike_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "boosterFine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boosterStrike" ENABLE ROW LEVEL SECURITY;
