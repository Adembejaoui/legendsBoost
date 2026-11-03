-- Simplify order statuses to PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED
-- PostgreSQL does not support removing enum values, so the OrderStatus type
-- is replaced with a new type containing only the target values.

-- Backfill legacy statuses onto values that exist in the new type.
-- QUEUED / PENDING_REVIEW orders have no active assignment and become PENDING.
-- ASSIGNED orders become IN_PROGRESS (their assignment stays active).
UPDATE "order" SET status = 'PENDING'::"OrderStatus" WHERE status IN ('QUEUED'::"OrderStatus", 'PENDING_REVIEW'::"OrderStatus");
UPDATE "order" SET status = 'IN_PROGRESS'::"OrderStatus" WHERE status = 'ASSIGNED'::"OrderStatus";

CREATE TYPE "OrderStatus_next" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "order" ALTER COLUMN status SET DEFAULT 'PENDING'::"OrderStatus_next";
ALTER TABLE "order" ALTER COLUMN status TYPE "OrderStatus_next" USING status::text::"OrderStatus_next";

DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_next" RENAME TO "OrderStatus";

-- Add PAUSED to AssignmentStatus (additive, historical values are unchanged)
ALTER TYPE "AssignmentStatus" ADD VALUE 'PAUSED';

-- Refresh the active-assignment check constraint: a paused assignment remains
-- active (keeps its activeOrderId) and must not be claimable by another booster.
ALTER TABLE "orderBoosterAssignment" DROP CONSTRAINT IF EXISTS "orderBoosterAssignment_active_order_check";
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_active_order_check" CHECK (
    ("activeOrderId" IS NULL AND "status" IN ('COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED'))
    OR
    ("activeOrderId" IS NOT NULL AND "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PAUSED') AND "activeOrderId" = "orderId")
);
