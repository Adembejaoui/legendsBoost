-- Stalled orders (2026-11-24): alert, email, final warning, then automatic
-- release with a fine. One timestamp per stage on the assignment, and a claim
-- block on the booster after repeated automatic releases.
ALTER TABLE "orderBoosterAssignment"
  ADD COLUMN "stallSoundAlertedAt" TIMESTAMP(3),
  ADD COLUMN "stallEmailedAt" TIMESTAMP(3),
  ADD COLUMN "stallFinalWarnedAt" TIMESTAMP(3);

ALTER TABLE "boosterProfile"
  ADD COLUMN "claimBlockedAt" TIMESTAMP(3),
  ADD COLUMN "claimBlockedReason" TEXT;
