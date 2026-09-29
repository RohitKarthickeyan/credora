-- CreateEnum
CREATE TYPE "core"."PipelineEventType" AS ENUM ('INTAKE_STARTED', 'INTAKE_SUBMITTED', 'ENVELOPE_COMPLETED', 'DOCUMENT_REVIEW_CLEARED', 'VERIFICATION_COMPLETED', 'CLEARANCE_GRANTED', 'SYNC_COMPLETED', 'WITHDRAWAL_RECORDED');

-- CreateTable
CREATE TABLE "core"."PipelineEvent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "fromStage" "core"."PipelineStage" NOT NULL,
    "toStage" "core"."PipelineStage" NOT NULL,
    "event" "core"."PipelineEventType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineEvent_agencyId_caregiverId_occurredAt_idx" ON "core"."PipelineEvent"("agencyId", "caregiverId", "occurredAt");

-- AddForeignKey
ALTER TABLE "core"."PipelineEvent" ADD CONSTRAINT "PipelineEvent_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
