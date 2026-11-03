/*
  These statements were created by LegendsBoost auth implementation.
  Run with: npx prisma db push (or npx prisma migrate deploy)
*/

-- Create enum first
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
        CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'BOOSTER', 'CUSTOMER');
    END IF;
END $$;

-- User table
CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" TIMESTAMP,
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" DEFAULT 'CUSTOMER' NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Account table
CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_in" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_providerAccountId_key" ON "account" ("provider", "providerAccountId");

-- Session table
CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL UNIQUE,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP NOT NULL,
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

-- VerificationToken table
CREATE TABLE IF NOT EXISTS "verificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "verificationToken_identifier_token_key" ON "verificationToken" ("identifier", "token");

-- CustomerProfile table
CREATE TABLE IF NOT EXISTS "customerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "phoneNumber" TEXT,
    "country" TEXT,
    "preferredLanguage" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT "customerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

-- BoosterProfile table
CREATE TABLE IF NOT EXISTS "boosterProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "biography" TEXT,
    "experienceYears" INTEGER,
    "languages" TEXT[],
    "specializations" TEXT[],
    "verificationStatus" TEXT DEFAULT 'PENDING' NOT NULL,
    "availabilityStatus" TEXT DEFAULT 'OFFLINE' NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT "boosterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);