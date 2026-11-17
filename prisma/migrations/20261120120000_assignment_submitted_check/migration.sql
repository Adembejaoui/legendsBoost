-- Fix (2026-11-17): a SUBMITTED assignment (completion waiting for the
-- customer, migration 20261118120000) keeps its activeOrderId so the booster
-- keeps the order page and chat. The check written before that status
-- existed refused it ("violates check constraint
-- orderBoosterAssignment_active_order_check"). Same rule, plus SUBMITTED in
-- the "holds the order" list. No data change: no row is SUBMITTED yet.

ALTER TABLE "orderBoosterAssignment" DROP CONSTRAINT IF EXISTS "orderBoosterAssignment_active_order_check";
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_active_order_check" CHECK (
    ("activeOrderId" IS NULL AND "status" IN ('COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED'))
    OR
    ("activeOrderId" IS NOT NULL AND "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED') AND "activeOrderId" = "orderId")
);
