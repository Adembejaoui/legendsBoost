-- BASELINE MIGRATION — DO NOT EXECUTE AGAINST PRODUCTION.
--
-- These tables and enums were created in production outside of Prisma
-- Migrate (they exist in the database but in no migration), so a fresh
-- database / Prisma's shadow database could never reproduce production.
-- This file was generated on 2026-11-12 with
--   prisma migrate diff --from-migrations <history up to 20261102210000> --to-config-datasource
-- i.e. from the live production schema itself, so it describes production
-- exactly as it is today (including NOT NULL "senderId" with ON DELETE
-- CASCADE, which the next migration changes).
--
-- Production must record it as already applied, without running it:
--   npx prisma migrate resolve --applied 20261111000000_baseline_chat_support_notification_tables
-- Fresh databases (dev, CI, shadow) apply it normally.

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('ORDER_CREATED', 'ORDER_CANCELLED', 'ORDER_STARTED', 'ORDER_PROGRESS_UPDATED', 'ORDER_COMPLETED', 'ORDER_REOPENED', 'BOOSTER_ASSIGNED', 'BOOSTER_ACCEPTED', 'BOOSTER_REJECTED', 'BOOSTER_REASSIGNED', 'BOOSTER_REMOVED', 'BOOSTER_ABANDONED', 'NEW_MESSAGE', 'SUPPORT_REPLY', 'SUPPORT_STATUS_UPDATED', 'SUPPORT_TICKET_CREATED', 'SUPPORT_TICKET_RESOLVED');

-- CreateEnum
CREATE TYPE "public"."SupportTicketCategory" AS ENUM ('ORDER_ISSUE', 'BOOSTER_ISSUE', 'PAYMENT_ISSUE', 'TECHNICAL_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."SupportTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "public"."notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."orderConversation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orderConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."orderMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isAdminReply" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supportTicket" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "public"."SupportTicketCategory" NOT NULL,
    "priority" "public"."SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "public"."SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "supportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_orderId_idx" ON "public"."notification"("orderId" ASC);

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "public"."notification"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "notification_userId_read_idx" ON "public"."notification"("userId" ASC, "read" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "orderConversation_orderId_key" ON "public"."orderConversation"("orderId" ASC);

-- CreateIndex
CREATE INDEX "orderMessage_conversationId_createdAt_idx" ON "public"."orderMessage"("conversationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "orderMessage_senderId_idx" ON "public"."orderMessage"("senderId" ASC);

-- CreateIndex
CREATE INDEX "supportMessage_senderId_idx" ON "public"."supportMessage"("senderId" ASC);

-- CreateIndex
CREATE INDEX "supportMessage_ticketId_createdAt_idx" ON "public"."supportMessage"("ticketId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "supportTicket_assignedAdminId_idx" ON "public"."supportTicket"("assignedAdminId" ASC);

-- CreateIndex
CREATE INDEX "supportTicket_customerId_idx" ON "public"."supportTicket"("customerId" ASC);

-- CreateIndex
CREATE INDEX "supportTicket_orderId_idx" ON "public"."supportTicket"("orderId" ASC);

-- CreateIndex
CREATE INDEX "supportTicket_status_idx" ON "public"."supportTicket"("status" ASC);

-- AddForeignKey
ALTER TABLE "public"."notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orderConversation" ADD CONSTRAINT "orderConversation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orderMessage" ADD CONSTRAINT "orderMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."orderConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orderMessage" ADD CONSTRAINT "orderMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supportMessage" ADD CONSTRAINT "supportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supportMessage" ADD CONSTRAINT "supportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."supportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supportTicket" ADD CONSTRAINT "supportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supportTicket" ADD CONSTRAINT "supportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supportTicket" ADD CONSTRAINT "supportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

