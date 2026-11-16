-- Order workspace: Riot profile snapshot + encrypted game-account credentials.
--
-- Additive only. No existing row is changed.
--  * orderRiotAccount.profile / profileSyncedAt: display-only Riot snapshot.
--  * orderAccountCredential: customer login for the booster, stored as
--    AES-256-GCM ciphertext produced by the application (the key is never in
--    the database). RLS is enabled with no policies, so Supabase's anon /
--    authenticated roles (PostgREST, Realtime) can never read it; only the
--    server's direct Postgres connection can.
--  * A trigger deletes the credentials as soon as the order is COMPLETED or
--    CANCELLED, whichever code path changes the status.
-- NOT APPLIED. Apply with `prisma migrate deploy` (staging first).

-- AlterTable
ALTER TABLE "orderRiotAccount" ADD COLUMN IF NOT EXISTS "profile" JSONB;
ALTER TABLE "orderRiotAccount" ADD COLUMN IF NOT EXISTS "profileSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "orderAccountCredential" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "usernameHint" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "revealCount" INTEGER NOT NULL DEFAULT 0,
    "lastRevealedAt" TIMESTAMP(3),
    "lastRevealedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orderAccountCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orderAccountCredential_orderId_key" ON "orderAccountCredential"("orderId");

-- AddForeignKey
ALTER TABLE "orderAccountCredential" ADD CONSTRAINT "orderAccountCredential_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lock the table away from Supabase's public API roles.
ALTER TABLE "orderAccountCredential" ENABLE ROW LEVEL SECURITY;

-- Purge credentials when an order is finished.
CREATE OR REPLACE FUNCTION purge_order_account_credential() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IN ('COMPLETED', 'CANCELLED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    DELETE FROM "orderAccountCredential" WHERE "orderId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_purge_account_credential ON "order";
CREATE TRIGGER order_purge_account_credential
AFTER UPDATE OF "status" ON "order"
FOR EACH ROW EXECUTE FUNCTION purge_order_account_credential();
