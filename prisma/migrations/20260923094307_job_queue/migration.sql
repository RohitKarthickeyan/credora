-- CreateEnum
CREATE TYPE "core"."JobState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD');

-- CreateTable
CREATE TABLE "core"."Job" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" "core"."JobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "lastError" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."JobAttempt" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_state_nextAttemptAt_idx" ON "core"."Job"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Job_agencyId_state_createdAt_idx" ON "core"."Job"("agencyId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_agencyId_id_key" ON "core"."Job"("agencyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Job_agencyId_idempotencyKey_key" ON "core"."Job"("agencyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "JobAttempt_agencyId_jobId_attempt_idx" ON "core"."JobAttempt"("agencyId", "jobId", "attempt");

-- AddForeignKey
ALTER TABLE "core"."Job" ADD CONSTRAINT "Job_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."JobAttempt" ADD CONSTRAINT "JobAttempt_agencyId_jobId_fkey" FOREIGN KEY ("agencyId", "jobId") REFERENCES "core"."Job"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
