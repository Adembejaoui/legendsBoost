-- Phase 5: games labelled by who played them (booster session / customer /
-- paused), LP change per game from rank snapshots, admin alert type.
-- Additive only. Existing matches keep counting for the booster (they were
-- attributed under the earlier rule). New enum values are not USED here.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'GAME_ANOMALY';

ALTER TABLE "orderMatch" ADD COLUMN "playedBy" TEXT NOT NULL DEFAULT 'BOOSTER';
ALTER TABLE "orderMatch" ADD COLUMN "lpDelta" INTEGER;
ALTER TABLE "orderMatch" ADD CONSTRAINT "orderMatch_playedBy_check" CHECK ("playedBy" IN ('BOOSTER', 'CUSTOMER', 'PAUSED'));

CREATE TABLE "orderRankSnapshot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "division" TEXT,
    "lp" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orderRankSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orderRankSnapshot_lp_check" CHECK ("lp" >= 0)
);
CREATE INDEX "orderRankSnapshot_orderId_takenAt_idx" ON "orderRankSnapshot"("orderId", "takenAt");
ALTER TABLE "orderRankSnapshot" ADD CONSTRAINT "orderRankSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orderRankSnapshot" ENABLE ROW LEVEL SECURITY;
