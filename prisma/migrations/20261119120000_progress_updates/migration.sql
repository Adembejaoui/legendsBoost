-- Booster progress updates (decision 2026-11-17): the booster reports the
-- current rank (and optional LP / RR); the order page shows progress from
-- these updates instead of Riot data. Additive only.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROGRESS_UPDATE_DUE';

CREATE TABLE "orderProgressUpdate" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "boosterId" TEXT NOT NULL,
  "rankSystemId" TEXT NOT NULL,
  "tierId" TEXT NOT NULL,
  "divisionId" TEXT,
  "lp" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orderProgressUpdate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "orderProgressUpdate_orderId_createdAt_idx" ON "orderProgressUpdate"("orderId", "createdAt");
ALTER TABLE "orderProgressUpdate"
  ADD CONSTRAINT "orderProgressUpdate_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same lock as every other table: RLS on, no policy, no API-role access.
ALTER TABLE "orderProgressUpdate" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "orderProgressUpdate" FROM %I', r);
    END IF;
  END LOOP;
END $$;
