-- Phase 7: saved booster payout methods (encrypted), payout snapshot of the
-- method, security alert on change.
-- Additive only. New enum values are not USED in this script.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_METHOD_CHANGED';

ALTER TABLE "boosterPayout" ADD COLUMN "methodType" TEXT;
ALTER TABLE "boosterPayout" ADD COLUMN "methodHint" TEXT;
ALTER TABLE "boosterPayout" ADD COLUMN "methodCiphertext" TEXT;
ALTER TABLE "boosterPayout" ADD COLUMN "methodRevealCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "boosterPayoutMethod" (
    "id" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boosterPayoutMethod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "boosterPayoutMethod_type_check" CHECK ("type" IN ('PAYPAL', 'IBAN', 'CRYPTO'))
);
CREATE UNIQUE INDEX "boosterPayoutMethod_boosterId_key" ON "boosterPayoutMethod"("boosterId");
ALTER TABLE "boosterPayoutMethod" ADD CONSTRAINT "boosterPayoutMethod_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server only: encrypted payout details.
ALTER TABLE "boosterPayoutMethod" ENABLE ROW LEVEL SECURITY;
