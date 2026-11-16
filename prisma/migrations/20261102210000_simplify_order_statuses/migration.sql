-- Simplify order statuses to PENDING, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED
-- PostgreSQL does not support removing enum values, so the OrderStatus type
-- is replaced with a new type containing only the target values.
--
-- Fixed 2026-11-12: the original script set the column default to an
-- "OrderStatus_next" value while the column was still "OrderStatus", which
-- fails with 42804 on any fresh database (including Prisma's shadow database).
-- The default is now dropped before the type change and restored afterwards.
-- The resulting schema is identical to what the original migration intended
-- (and to the current production state).
--
-- Execution model (verified): Prisma runs a script without dollar-quoted
-- blocks statement by statement, committing each one. The explicit
-- BEGIN/COMMIT groups below make the enum swap and the constraint swap
-- all-or-nothing, while ADD VALUE commits on its own before PAUSED is used.
-- Do not add DO $$ ... $$ blocks here: Prisma would then send the whole script
-- as one implicit transaction and the new PAUSED value could not be used
-- (55P04 "unsafe use of new value").

BEGIN;

-- Backfill legacy statuses onto values that exist in the new type.
-- QUEUED / PENDING_REVIEW orders have no active assignment and become PENDING.
-- ASSIGNED orders become IN_PROGRESS (their assignment stays active).
UPDATE "order" SET "status" = 'PENDING'::"OrderStatus" WHERE "status" IN ('QUEUED'::"OrderStatus", 'PENDING_REVIEW'::"OrderStatus");
UPDATE "order" SET "status" = 'IN_PROGRESS'::"OrderStatus" WHERE "status" = 'ASSIGNED'::"OrderStatus";

CREATE TYPE "OrderStatus_next" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- 1. The old default ('PENDING'::"OrderStatus") cannot be cast automatically.
ALTER TABLE "order" ALTER COLUMN "status" DROP DEFAULT;

-- 2. Convert by label. Every remaining value exists in the new type after the
--    backfill; any unexpected value aborts the whole transaction instead of
--    being silently changed. order_status_idx is rebuilt automatically.
ALTER TABLE "order" ALTER COLUMN "status" TYPE "OrderStatus_next" USING ("status"::text::"OrderStatus_next");

-- 3. Swap the type names.
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_next" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";

-- 4. Restore the default with the new type.
ALTER TABLE "order" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"OrderStatus";

COMMIT;

-- Add PAUSED to AssignmentStatus (additive, historical values are unchanged).
-- Outside any transaction block: a newly added enum value cannot be used
-- until the statement that added it has committed.
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- Refresh the active-assignment check constraint: a paused assignment remains
-- active (keeps its activeOrderId) and must not be claimable by another booster.
-- Drop + add atomically so the table is never left without the constraint.
BEGIN;
ALTER TABLE "orderBoosterAssignment" DROP CONSTRAINT IF EXISTS "orderBoosterAssignment_active_order_check";
ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_active_order_check" CHECK (
    ("activeOrderId" IS NULL AND "status" IN ('COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED'))
    OR
    ("activeOrderId" IS NOT NULL AND "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PAUSED') AND "activeOrderId" = "orderId")
);
COMMIT;
