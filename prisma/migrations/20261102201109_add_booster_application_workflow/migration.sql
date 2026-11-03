-- AlterTable
ALTER TABLE "boosterProfile" ADD COLUMN     "applicationData" JSONB,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "welcomeModalSeen" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "boosterProfile" ADD CONSTRAINT "boosterProfile_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
