-- Completion with proof + customer confirmation (decision 2026-11-16).
-- Replaces the Riot check in production: the booster uploads 1-3 end
-- screenshots, the order waits for the customer (72 h, then auto-confirm),
-- a reported problem goes to an admin. Additive only: no existing row changes.

-- New enum values (each ADD VALUE commits on its own; none is used below).
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CONFIRMATION';
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLETION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLETION_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLETION_SENT_BACK';

CREATE TYPE "CompletionRequestStatus" AS ENUM (
  'PENDING', 'DISPUTED', 'CONFIRMED', 'AUTO_CONFIRMED', 'ADMIN_ACCEPTED', 'RIOT_CONFIRMED', 'SENT_BACK'
);

CREATE TABLE "orderCompletionRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "boosterId" TEXT NOT NULL,
  "status" "CompletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "boosterNote" TEXT,
  "autoConfirmAt" TIMESTAMP(3) NOT NULL,
  "disputeReason" TEXT,
  "disputedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "adminNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orderCompletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "orderCompletionRequest_orderId_idx" ON "orderCompletionRequest"("orderId");
CREATE INDEX "orderCompletionRequest_status_autoConfirmAt_idx" ON "orderCompletionRequest"("status", "autoConfirmAt");
-- At most one open request per order.
CREATE UNIQUE INDEX "orderCompletionRequest_one_open_per_order"
  ON "orderCompletionRequest"("orderId") WHERE "status" IN ('PENDING', 'DISPUTED');
ALTER TABLE "orderCompletionRequest"
  ADD CONSTRAINT "orderCompletionRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "orderCompletionProof" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orderCompletionProof_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orderCompletionProof_storagePath_key" ON "orderCompletionProof"("storagePath");
CREATE INDEX "orderCompletionProof_requestId_idx" ON "orderCompletionProof"("requestId");
CREATE INDEX "orderCompletionProof_orderId_idx" ON "orderCompletionProof"("orderId");
ALTER TABLE "orderCompletionProof"
  ADD CONSTRAINT "orderCompletionProof_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "orderCompletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same lock as every other table: RLS on, no policy, no API-role access.
ALTER TABLE "orderCompletionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orderCompletionProof" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "orderCompletionRequest" FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE "orderCompletionProof" FROM %I', r);
    END IF;
  END LOOP;
END $$;
