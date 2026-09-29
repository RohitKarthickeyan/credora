-- CreateTable
CREATE TABLE "core"."ChrcSubmission" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChrcSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChrcSubmission_agencyId_caregiverId_key" ON "core"."ChrcSubmission"("agencyId", "caregiverId");

-- AddForeignKey
ALTER TABLE "core"."ChrcSubmission" ADD CONSTRAINT "ChrcSubmission_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
