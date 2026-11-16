-- Phase 4: booster play sessions (required to reveal the login), a reveal
-- log with IP, and chat moderation flags (contact / payment details hidden).
-- Additive only. New enum values are not USED in this script (PostgreSQL
-- requires ADD VALUE to commit before use), and there are no DO $$ blocks.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_STARTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLETION_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CHAT_FLAGGED';

CREATE TABLE "orderSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "orderSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orderSession_end_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);
CREATE INDEX "orderSession_orderId_startedAt_idx" ON "orderSession"("orderId", "startedAt");
CREATE INDEX "orderSession_boosterId_idx" ON "orderSession"("boosterId");
-- At most one open session per assignment.
CREATE UNIQUE INDEX "orderSession_one_open_per_assignment" ON "orderSession"("assignmentId") WHERE "endedAt" IS NULL;
ALTER TABLE "orderSession" ADD CONSTRAINT "orderSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orderSession" ADD CONSTRAINT "orderSession_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "orderBoosterAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "orderCredentialReveal" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "sessionId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orderCredentialReveal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "orderCredentialReveal_orderId_createdAt_idx" ON "orderCredentialReveal"("orderId", "createdAt");
ALTER TABLE "orderCredentialReveal" ADD CONSTRAINT "orderCredentialReveal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "chatModerationFlag" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "senderId" TEXT,
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "original" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    CONSTRAINT "chatModerationFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chatModerationFlag_messageId_key" ON "chatModerationFlag"("messageId");
CREATE INDEX "chatModerationFlag_reviewedAt_createdAt_idx" ON "chatModerationFlag"("reviewedAt", "createdAt");
ALTER TABLE "chatModerationFlag" ADD CONSTRAINT "chatModerationFlag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chatModerationFlag" ADD CONSTRAINT "chatModerationFlag_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "orderMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server only (no client access through the Supabase API): the original
-- flagged text and reveal IPs are sensitive.
ALTER TABLE "orderSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orderCredentialReveal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chatModerationFlag" ENABLE ROW LEVEL SECURITY;
