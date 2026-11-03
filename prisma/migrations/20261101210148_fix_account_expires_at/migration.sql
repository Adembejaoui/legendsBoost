/*
  Warnings:

  - You are about to drop the column `expires_in` on the `account` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[token]` on the table `verificationToken` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "account" DROP CONSTRAINT "account_userId_fkey";

-- DropForeignKey
ALTER TABLE "boosterProfile" DROP CONSTRAINT "boosterProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "customerProfile" DROP CONSTRAINT "customerProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "session" DROP CONSTRAINT "session_userId_fkey";

-- AlterTable
ALTER TABLE "account" DROP COLUMN "expires_in",
ADD COLUMN     "expires_at" INTEGER;

-- AlterTable
ALTER TABLE "boosterProfile" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customerProfile" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "session" ALTER COLUMN "expires" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "emailVerified" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "role" DROP NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "verificationToken" ALTER COLUMN "expires" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "verificationToken_token_key" ON "verificationToken"("token");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customerProfile" ADD CONSTRAINT "customerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boosterProfile" ADD CONSTRAINT "boosterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
