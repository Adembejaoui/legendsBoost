-- Order workspace: DRAFT status, completion timestamp, notification
-- idempotency, Riot account identification and order-attributed matches.
--
-- Additive only: no existing rows are changed or removed.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on
-- PostgreSQL < 12 and the new value cannot be *used* in the same transaction.
-- Nothing below uses 'DRAFT', so this is safe on Supabase (PG 15+).

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

BEGIN;

CREATE TYPE "RiotAccountLinkStatus" AS ENUM ('MANUAL', 'RESOLVED', 'RSO_VERIFIED');

ALTER TABLE "order" ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "notification" ADD COLUMN "dedupeKey" TEXT;
-- NULL dedupeKeys never conflict, so ordinary notifications are unaffected.
CREATE UNIQUE INDEX "notification_userId_dedupeKey_key" ON "notification"("userId", "dedupeKey");

CREATE TABLE "orderRiotAccount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "platform" TEXT,
    "puuid" TEXT,
    "linkStatus" "RiotAccountLinkStatus" NOT NULL DEFAULT 'MANUAL',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "observedTier" TEXT,
    "observedDivision" TEXT,
    "observedLp" INTEGER,
    "observedAt" TIMESTAMP(3),
    "reportedTier" TEXT,
    "reportedDivision" TEXT,
    "reportedLp" INTEGER,
    "reportedAt" TIMESTAMP(3),
    "reportedById" TEXT,
    "baselineTier" TEXT,
    "baselineDivision" TEXT,
    "baselineLp" INTEGER,
    "baselineAt" TIMESTAMP(3),
    "baselineSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orderRiotAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orderRiotAccount_orderId_key" ON "orderRiotAccount"("orderId");
ALTER TABLE "orderRiotAccount" ADD CONSTRAINT "orderRiotAccount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "orderMatch" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "championId" INTEGER NOT NULL,
    "championName" TEXT NOT NULL,
    "win" BOOLEAN NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "cs" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "gameStartAt" TIMESTAMP(3) NOT NULL,
    "gameEndAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orderMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orderMatch_orderId_matchId_key" ON "orderMatch"("orderId", "matchId");
CREATE INDEX "orderMatch_orderId_gameStartAt_idx" ON "orderMatch"("orderId", "gameStartAt");
ALTER TABLE "orderMatch" ADD CONSTRAINT "orderMatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defence in depth for Supabase: with RLS on and no policies, the anon and
-- authenticated roles (PostgREST / Data API) can read nothing. Prisma
-- connects as the table owner, which bypasses RLS (no FORCE).
ALTER TABLE "orderRiotAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orderMatch" ENABLE ROW LEVEL SECURITY;

COMMIT;
