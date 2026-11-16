-- Phase 1: order marketplace payment gate.
--
-- Additive only. No existing row is read, changed or removed:
--   * every existing order keeps its status;
--   * every existing order gets paymentVerifiedAt = NULL ("no verified
--     payment"), which the application treats as NOT paid. Existing PENDING
--     orders therefore stop being listed/claimable until a payment is
--     verified or an admin reconciles them (see
--     docs/PHASE-1-ORDER-SAFETY-REPORT.md and scripts/report-legacy-orders.mjs).
--
-- The column default is left unchanged ('PENDING') on purpose: switching it
-- to the new enum value would *use* that value in the same migration, which
-- PostgreSQL rejects (55P04) when both run in one transaction. The
-- application sets AWAITING_PAYMENT explicitly on creation, and the payment
-- gate (paymentVerifiedAt) protects any row created through another path.
--
-- `ALTER TYPE ... ADD VALUE` must commit before the value is used. Nothing
-- below uses it, and there are no DO $$ blocks (see the notes in
-- 20261102210000_simplify_order_statuses and
-- 20261112200000_order_workspace_draft_riot_matches).
--
-- Generated with: prisma migrate diff --from-schema <previous> --to-schema prisma/schema.prisma --script
-- NOT APPLIED. Apply with `prisma migrate deploy` in staging first.

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';

-- AlterTable
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "paymentVerifiedAt" TIMESTAMP(3);
