-- AlterEnum
ALTER TYPE "core"."JobState" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "core"."JobSchedule" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "nextOccurrenceAt" TIMESTAMP(3) NOT NULL,
    "lastOccurrenceAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "skippedOccurrences" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobSchedule_nextOccurrenceAt_idx" ON "core"."JobSchedule"("nextOccurrenceAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSchedule_agencyId_key_key" ON "core"."JobSchedule"("agencyId", "key");

-- AddForeignKey
ALTER TABLE "core"."JobSchedule" ADD CONSTRAINT "JobSchedule_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
