-- Riot sync integrity (audit remediation).
--
-- Additive only: new nullable / defaulted columns and one new table.
-- No existing rows are changed or removed. Not applied automatically.

BEGIN;

ALTER TABLE "orderRiotAccount"
    ADD COLUMN "lastSyncErrorCode" TEXT,
    ADD COLUMN "regionVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "matchScanUntil" TIMESTAMP(3),
    ADD COLUMN "pendingMatchIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "syncLeaseUntil" TIMESTAMP(3);

CREATE TABLE "riotApiThrottle" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "riotApiThrottle_pkey" PRIMARY KEY ("key")
);

-- Same defence in depth as the other Riot tables: no Data API access.
ALTER TABLE "riotApiThrottle" ENABLE ROW LEVEL SECURITY;

COMMIT;
