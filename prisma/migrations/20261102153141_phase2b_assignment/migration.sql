-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'QUEUED';
ALTER TYPE "OrderStatus" ADD VALUE 'ASSIGNED';

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

-- CreateIndex
CREATE INDEX "orderBoosterAssignment_orderId_idx" ON "orderBoosterAssignment"("orderId");

-- CreateIndex
CREATE INDEX "orderBoosterAssignment_boosterId_idx" ON "orderBoosterAssignment"("boosterId");

-- CreateIndex
CREATE INDEX "orderBoosterAssignment_status_idx" ON "orderBoosterAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orderBoosterAssignment_activeOrderId_key" ON "orderBoosterAssignment"("activeOrderId");

-- AddForeignKey
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
