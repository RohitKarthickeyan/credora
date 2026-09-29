-- AlterTable
ALTER TABLE "core"."Caregiver" ADD COLUMN     "trainingPlatformId" TEXT;

-- AlterTable
ALTER TABLE "core"."Evidence" ADD COLUMN     "trainingCompletionId" TEXT;

-- CreateTable
CREATE TABLE "core"."TrainingImport" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "addedCount" INTEGER NOT NULL,

    CONSTRAINT "TrainingImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."TrainingImportRejection" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "TrainingImportRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."TrainingCompletion" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "externalCaregiverId" TEXT NOT NULL,
    "caregiverId" TEXT,
    "courseCode" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "completedOn" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingImport_agencyId_importedAt_idx" ON "core"."TrainingImport"("agencyId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingImport_agencyId_id_key" ON "core"."TrainingImport"("agencyId", "id");

-- CreateIndex
CREATE INDEX "TrainingImportRejection_agencyId_importId_idx" ON "core"."TrainingImportRejection"("agencyId", "importId");

-- CreateIndex
CREATE INDEX "TrainingCompletion_agencyId_caregiverId_idx" ON "core"."TrainingCompletion"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCompletion_agencyId_externalCaregiverId_courseCode__key" ON "core"."TrainingCompletion"("agencyId", "externalCaregiverId", "courseCode", "completedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Caregiver_agencyId_trainingPlatformId_key" ON "core"."Caregiver"("agencyId", "trainingPlatformId");

-- AddForeignKey
ALTER TABLE "core"."Evidence" ADD CONSTRAINT "Evidence_trainingCompletionId_fkey" FOREIGN KEY ("trainingCompletionId") REFERENCES "core"."TrainingCompletion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."TrainingImportRejection" ADD CONSTRAINT "TrainingImportRejection_agencyId_importId_fkey" FOREIGN KEY ("agencyId", "importId") REFERENCES "core"."TrainingImport"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every evidence source column that exists, plus this arm's (ADR-028).
ALTER TABLE core."Evidence" DROP CONSTRAINT "Evidence_exactly_one_source";
ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_exactly_one_source"
  CHECK (num_nonnulls("signedDocumentId", "uploadedDocumentId", "attestationId", "checkResultId", "trainingCompletionId") = 1);

ALTER TABLE core."Evidence" ADD CONSTRAINT "Evidence_training_completion_source"
  CHECK (("kind" = 'TRAINING_RECORD'::core."EvidenceKind") = ("trainingCompletionId" IS NOT NULL));

ALTER TABLE core."TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_minutes_nonnegative"
  CHECK ("minutes" >= 0);

-- Postgres runs each cascade as its own statement, so a caregiver delete checks this FK before Evidence's cascade has run.
ALTER TABLE "core"."Evidence" ALTER CONSTRAINT "Evidence_trainingCompletionId_fkey" DEFERRABLE INITIALLY DEFERRED;
