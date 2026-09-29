-- CreateEnum
CREATE TYPE "core"."AlayaCareSyncStatus" AS ENUM ('RUNNING', 'SYNCED', 'CONFLICT', 'REJECTED');

-- CreateTable
CREATE TABLE "core"."AlayaCareSync" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "status" "core"."AlayaCareSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "externalId" TEXT,
    "credentialsWritten" INTEGER NOT NULL DEFAULT 0,
    "unmappedCredentialTypes" "core"."CredentialType"[],
    "unresolvedCustomFields" TEXT[],
    "conflictFields" TEXT[],
    "reason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlayaCareSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlayaCareSync_agencyId_caregiverId_startedAt_idx" ON "core"."AlayaCareSync"("agencyId", "caregiverId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlayaCareSync_agencyId_jobId_key" ON "core"."AlayaCareSync"("agencyId", "jobId");

-- AddForeignKey
ALTER TABLE "core"."AlayaCareSync" ADD CONSTRAINT "AlayaCareSync_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
