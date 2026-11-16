-- Production audit: "sign out everywhere". Sessions carry the account's
-- sessionVersion; changing or resetting the password bumps it, which ends
-- every session signed in before. Additive only.
-- NOT APPLIED. Apply with `prisma migrate deploy`.

ALTER TABLE "user" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
