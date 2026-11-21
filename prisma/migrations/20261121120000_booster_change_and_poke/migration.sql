-- Customer dashboard changes (client PDF 2026-11-21):
-- "Poke booster" (one email per hour) and "Change booster" requests reviewed by an admin.

ALTER TABLE "order" ADD COLUMN "boosterPokedAt" TIMESTAMP(3);

CREATE TABLE "orderBoosterChangeRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "adminNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orderBoosterChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "orderBoosterChangeRequest_orderId_idx" ON "orderBoosterChangeRequest"("orderId");
CREATE INDEX "orderBoosterChangeRequest_status_createdAt_idx" ON "orderBoosterChangeRequest"("status", "createdAt");
-- At most one open request per order.
CREATE UNIQUE INDEX "orderBoosterChangeRequest_one_open_per_order" ON "orderBoosterChangeRequest"("orderId") WHERE "status" = 'REQUESTED';
ALTER TABLE "orderBoosterChangeRequest" ADD CONSTRAINT "orderBoosterChangeRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orderBoosterChangeRequest" ENABLE ROW LEVEL SECURITY;
