-- Phase 0.B foundation: admin-editable config, general audit log, job leases.
-- Additive only. RLS enabled with no policies: only the server's direct
-- Postgres connection can read or write these tables (not Supabase anon).
-- NOT APPLIED. Apply with `prisma migrate deploy`.

CREATE TABLE "appConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "appConfig_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "auditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auditLog_entityType_entityId_idx" ON "auditLog"("entityType", "entityId");
CREATE INDEX "auditLog_actorId_createdAt_idx" ON "auditLog"("actorId", "createdAt");
CREATE INDEX "auditLog_action_createdAt_idx" ON "auditLog"("action", "createdAt");

CREATE TABLE "jobLease" (
    "name" TEXT NOT NULL,
    "leasedUntil" TIMESTAMP(3),
    "runId" TEXT,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    CONSTRAINT "jobLease_pkey" PRIMARY KEY ("name")
);

ALTER TABLE "appConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobLease" ENABLE ROW LEVEL SECURITY;
