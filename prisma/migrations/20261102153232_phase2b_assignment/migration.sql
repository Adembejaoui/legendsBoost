-- Add CHECK constraint to enforce activeOrderId is only set when status is active
-- Active statuses: ASSIGNED, ACCEPTED, IN_PROGRESS
-- Inactive statuses: COMPLETED, DECLINED, CANCELLED, RELEASED
ALTER TABLE "orderBoosterAssignment"
ADD CONSTRAINT "orderBoosterAssignment_active_order_check"
CHECK (
    ("activeOrderId" IS NULL AND "status" IN ('COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED'))
    OR
    ("activeOrderId" IS NOT NULL AND "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS') AND "activeOrderId" = "orderId")
);