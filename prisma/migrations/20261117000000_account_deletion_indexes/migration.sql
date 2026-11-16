-- Phase 9: account deletion requests (GDPR), soft-deleted users, and
-- indexes for the queries that run most often (pool, booster capacity,
-- booster wins, SLA / inactivity message checks).
-- Additive only. New enum values are not USED in this script.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETION_REQUESTED';

ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TYPE "AccountDeletionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "accountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    CONSTRAINT "accountDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "accountDeletionRequest_status_requestedAt_idx" ON "accountDeletionRequest"("status", "requestedAt");
CREATE INDEX "accountDeletionRequest_userId_idx" ON "accountDeletionRequest"("userId");
-- One open request per user.
CREATE UNIQUE INDEX "accountDeletionRequest_one_open_per_user" ON "accountDeletionRequest"("userId") WHERE "status" = 'REQUESTED';
ALTER TABLE "accountDeletionRequest" ADD CONSTRAINT "accountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accountDeletionRequest" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "orderBoosterAssignment_boosterId_status_idx" ON "orderBoosterAssignment"("boosterId", "status");
CREATE INDEX IF NOT EXISTS "orderMatch_orderId_playedBy_win_idx" ON "orderMatch"("orderId", "playedBy", "win");
CREATE INDEX IF NOT EXISTS "orderMessage_senderId_createdAt_idx" ON "orderMessage"("senderId", "createdAt");
CREATE INDEX IF NOT EXISTS "order_status_createdAt_idx" ON "order"("status", "createdAt");
