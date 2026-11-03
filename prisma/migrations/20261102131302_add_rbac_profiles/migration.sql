/*
  Warnings:

  - The `specializations` column on the `boosterProfile` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `verificationStatus` column on the `boosterProfile` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `availabilityStatus` column on the `boosterProfile` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "BoosterVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BoosterAvailabilityStatus" AS ENUM ('AVAILABLE', 'BUSY', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "boosterProfile" ALTER COLUMN "languages" SET DEFAULT ARRAY[]::TEXT[],
DROP COLUMN "specializations",
ADD COLUMN     "specializations" JSONB,
DROP COLUMN "verificationStatus",
ADD COLUMN     "verificationStatus" "BoosterVerificationStatus" NOT NULL DEFAULT 'PENDING',
DROP COLUMN "availabilityStatus",
ADD COLUMN     "availabilityStatus" "BoosterAvailabilityStatus" NOT NULL DEFAULT 'UNAVAILABLE';
