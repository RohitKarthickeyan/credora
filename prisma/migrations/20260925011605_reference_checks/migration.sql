-- CreateEnum
CREATE TYPE "core"."ReferenceRequestStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'RESPONDED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "core"."ReferenceAttemptStatus" AS ENUM ('QUEUED', 'SENT', 'REJECTED', 'UNANSWERED');

-- AlterTable
ALTER TABLE "core"."Reference" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "requestStatus" "core"."ReferenceRequestStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "responseComments" TEXT,
ADD COLUMN     "responseRecordedByUserId" TEXT,
ADD COLUMN     "workedWith" BOOLEAN,
ADD COLUMN     "wouldRecommend" BOOLEAN;

-- CreateTable
CREATE TABLE "core"."ReferenceAttempt" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "core"."ReferenceAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "sentChannels" "core"."MessageChannel"[],
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceAttempt_agencyId_referenceId_number_key" ON "core"."ReferenceAttempt"("agencyId", "referenceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Reference_agencyId_id_key" ON "core"."Reference"("agencyId", "id");

-- AddForeignKey
ALTER TABLE "core"."ReferenceAttempt" ADD CONSTRAINT "ReferenceAttempt_agencyId_referenceId_fkey" FOREIGN KEY ("agencyId", "referenceId") REFERENCES "core"."Reference"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
