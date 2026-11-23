-- Blog (2026-11-23): posts written by admins in Markdown, one row per
-- language (translations share "translationGroup"), and uploaded images.

CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "blogPost" (
    "id" TEXT NOT NULL,
    "translationGroup" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "coverImageId" TEXT,
    "gameSlug" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "blogPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "blogPost_locale_slug_key" ON "blogPost"("locale", "slug");
CREATE UNIQUE INDEX "blogPost_translationGroup_locale_key" ON "blogPost"("translationGroup", "locale");
CREATE INDEX "blogPost_status_locale_publishedAt_idx" ON "blogPost"("status", "locale", "publishedAt");
ALTER TABLE "blogPost" ADD CONSTRAINT "blogPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A published post always has a publication date.
ALTER TABLE "blogPost" ADD CONSTRAINT "blogPost_published_has_date" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);

CREATE TABLE "blogImage" (
    "id" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blogImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "blogImage_storagePath_key" ON "blogImage"("storagePath");

-- Same rule as every table: only the server (service role / Prisma) reads them.
ALTER TABLE "blogPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blogImage" ENABLE ROW LEVEL SECURITY;
