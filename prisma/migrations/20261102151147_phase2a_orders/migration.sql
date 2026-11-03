-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PENDING_REVIEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

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

-- CreateIndex
CREATE INDEX "order_userId_idx" ON "order"("userId");

-- CreateIndex
CREATE INDEX "order_status_idx" ON "order"("status");

-- CreateIndex
CREATE INDEX "orderEvent_orderId_idx" ON "orderEvent"("orderId");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orderEvent" ADD CONSTRAINT "orderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
