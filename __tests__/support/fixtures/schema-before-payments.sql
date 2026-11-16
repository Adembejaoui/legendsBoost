-- Test fixture: database schema immediately BEFORE migration
-- 20261114000000_payments_and_financial_ledger (generated with
-- prisma migrate diff --from-empty --to-schema <schema before payments>).
-- Used only by __tests__/support/pg-test-db.ts to build an in-memory
-- PGlite database; never applied to a real database.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'BOOSTER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "BoosterVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BoosterAvailabilityStatus" AS ENUM ('AVAILABLE', 'BUSY', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED', 'DRAFT', 'AWAITING_PAYMENT');

-- CreateEnum
CREATE TYPE "RiotAccountLinkStatus" AS ENUM ('MANUAL', 'RESOLVED', 'RSO_VERIFIED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_CREATED', 'ORDER_CANCELLED', 'ORDER_STARTED', 'ORDER_PROGRESS_UPDATED', 'ORDER_COMPLETED', 'ORDER_REOPENED', 'BOOSTER_ASSIGNED', 'BOOSTER_ACCEPTED', 'BOOSTER_REJECTED', 'BOOSTER_REASSIGNED', 'BOOSTER_REMOVED', 'BOOSTER_ABANDONED', 'NEW_MESSAGE', 'SUPPORT_REPLY', 'SUPPORT_STATUS_UPDATED', 'SUPPORT_TICKET_CREATED', 'SUPPORT_TICKET_RESOLVED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('ORDER_ISSUE', 'BOOSTER_ISSUE', 'PAYMENT_ISSUE', 'TECHNICAL_ISSUE', 'OTHER');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" DEFAULT 'CUSTOMER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "customerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "country" TEXT,
    "preferredLanguage" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boosterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "biography" TEXT,
    "experienceYears" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specializations" JSONB,
    "applicationData" JSONB,
    "verificationStatus" "BoosterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "availabilityStatus" "BoosterAvailabilityStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "welcomeModalSeen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boosterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "serviceSlug" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "selectedMode" TEXT,
    "selectedOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "championsRoles" JSONB,
    "price" DECIMAL(10,2),
    "currency" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "paymentVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orderBoosterAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "activeOrderId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orderBoosterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "lastSyncErrorCode" TEXT,
    "regionVerifiedAt" TIMESTAMP(3),
    "matchScanUntil" TIMESTAMP(3),
    "pendingMatchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "syncLeaseUntil" TIMESTAMP(3),
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "riotApiThrottle" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riotApiThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "orderConversation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orderConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orderMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supportTicket" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "supportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderId" TEXT,
    "content" TEXT NOT NULL,
    "isAdminReply" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_providerAccountId_key" ON "account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "session_sessionToken_key" ON "session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verificationToken_token_key" ON "verificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verificationToken_identifier_token_key" ON "verificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "customerProfile_userId_key" ON "customerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "boosterProfile_userId_key" ON "boosterProfile"("userId");

-- CreateIndex
CREATE INDEX "order_userId_idx" ON "order"("userId");

-- CreateIndex
CREATE INDEX "order_status_idx" ON "order"("status");

-- CreateIndex
CREATE INDEX "orderEvent_orderId_idx" ON "orderEvent"("orderId");

-- CreateIndex
CREATE INDEX "orderBoosterAssignment_orderId_idx" ON "orderBoosterAssignment"("orderId");

-- CreateIndex
CREATE INDEX "orderBoosterAssignment_boosterId_idx" ON "orderBoosterAssignment"("boosterId");

-- CreateIndex
CREATE INDEX "orderBoosterAssignment_status_idx" ON "orderBoosterAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orderBoosterAssignment_activeOrderId_key" ON "orderBoosterAssignment"("activeOrderId");

-- CreateIndex
CREATE INDEX "notification_userId_read_idx" ON "notification"("userId", "read");

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_orderId_idx" ON "notification"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_userId_dedupeKey_key" ON "notification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "orderRiotAccount_orderId_key" ON "orderRiotAccount"("orderId");

-- CreateIndex
CREATE INDEX "orderMatch_orderId_gameStartAt_idx" ON "orderMatch"("orderId", "gameStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "orderMatch_orderId_matchId_key" ON "orderMatch"("orderId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "orderConversation_orderId_key" ON "orderConversation"("orderId");

-- CreateIndex
CREATE INDEX "orderMessage_conversationId_createdAt_idx" ON "orderMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "orderMessage_senderId_idx" ON "orderMessage"("senderId");

-- CreateIndex
CREATE INDEX "supportTicket_customerId_idx" ON "supportTicket"("customerId");

-- CreateIndex
CREATE INDEX "supportTicket_orderId_idx" ON "supportTicket"("orderId");

-- CreateIndex
CREATE INDEX "supportTicket_status_idx" ON "supportTicket"("status");

-- CreateIndex
CREATE INDEX "supportTicket_assignedAdminId_idx" ON "supportTicket"("assignedAdminId");

-- CreateIndex
CREATE INDEX "supportMessage_ticketId_createdAt_idx" ON "supportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "supportMessage_senderId_idx" ON "supportMessage"("senderId");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customerProfile" ADD CONSTRAINT "customerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterProfile" ADD CONSTRAINT "boosterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterProfile" ADD CONSTRAINT "boosterProfile_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderEvent" ADD CONSTRAINT "orderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderRiotAccount" ADD CONSTRAINT "orderRiotAccount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderMatch" ADD CONSTRAINT "orderMatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderConversation" ADD CONSTRAINT "orderConversation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderMessage" ADD CONSTRAINT "orderMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "orderConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderMessage" ADD CONSTRAINT "orderMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supportTicket" ADD CONSTRAINT "supportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supportTicket" ADD CONSTRAINT "supportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supportTicket" ADD CONSTRAINT "supportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supportMessage" ADD CONSTRAINT "supportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "supportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supportMessage" ADD CONSTRAINT "supportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

