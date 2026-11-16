-- Bring production in line with prisma/schema.prisma (generated with
-- prisma migrate diff --from-config-datasource --to-schema, 2026-11-12).
--
-- 1. orderMessage / supportMessage."senderId" become nullable and the sender
--    foreign keys switch from ON DELETE CASCADE to ON DELETE SET NULL, so
--    deleting a user account keeps the conversation history (shown as
--    "Deleted user") instead of deleting every message they sent.
-- 2. Add the missing notification."orderId" -> order foreign key
--    (production had 0 orphaned rows when this was written).
--
-- Additive / relaxing only: no rows are changed or removed. One transaction,
-- so a table is never left without its sender foreign key.

BEGIN;

ALTER TABLE "orderMessage" DROP CONSTRAINT "orderMessage_senderId_fkey";
ALTER TABLE "supportMessage" DROP CONSTRAINT "supportMessage_senderId_fkey";

ALTER TABLE "orderMessage" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "supportMessage" ALTER COLUMN "senderId" DROP NOT NULL;

ALTER TABLE "orderMessage" ADD CONSTRAINT "orderMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supportMessage" ADD CONSTRAINT "supportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification" ADD CONSTRAINT "notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
