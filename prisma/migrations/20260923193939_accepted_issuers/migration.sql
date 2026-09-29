-- CreateEnum
CREATE TYPE "core"."AcceptedIssuerKind" AS ENUM ('TRAINING_PROGRAM', 'CLINIC', 'STATE_AGENCY');

-- AlterEnum
ALTER TYPE "core"."AuditEntityType" ADD VALUE 'ACCEPTED_ISSUER';

-- CreateTable
CREATE TABLE "core"."AcceptedIssuer" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "core"."AcceptedIssuerKind" NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcceptedIssuer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcceptedIssuer_agencyId_retiredAt_idx" ON "core"."AcceptedIssuer"("agencyId", "retiredAt");

-- AddForeignKey
ALTER TABLE "core"."AcceptedIssuer" ADD CONSTRAINT "AcceptedIssuer_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
