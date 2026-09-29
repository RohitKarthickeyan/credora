-- CreateEnum
CREATE TYPE "core"."EnvelopeStatus" AS ENUM ('PREPARING', 'SENT', 'SIGNED', 'DECLINED', 'VOIDED');

-- CreateTable
CREATE TABLE "core"."Envelope" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "status" "core"."EnvelopeStatus" NOT NULL DEFAULT 'PREPARING',
    "vendorEnvelopeId" TEXT,
    "signingUrl" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."EnvelopeDocument" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unsignedPdfKey" TEXT NOT NULL,

    CONSTRAINT "EnvelopeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Envelope_agencyId_caregiverId_idx" ON "core"."Envelope"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_agencyId_id_key" ON "core"."Envelope"("agencyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_agencyId_vendorEnvelopeId_key" ON "core"."Envelope"("agencyId", "vendorEnvelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvelopeDocument_agencyId_envelopeId_documentKey_key" ON "core"."EnvelopeDocument"("agencyId", "envelopeId", "documentKey");

-- AddForeignKey
ALTER TABLE "core"."Envelope" ADD CONSTRAINT "Envelope_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EnvelopeDocument" ADD CONSTRAINT "EnvelopeDocument_agencyId_envelopeId_fkey" FOREIGN KEY ("agencyId", "envelopeId") REFERENCES "core"."Envelope"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The two statements below are hand-written (T-064 § Design 3). Prisma 7 cannot express a
-- CHECK constraint or a partial unique index in the PSL, and does not introspect either, so
-- they neither appear in schema.prisma nor read as drift.

-- A caregiver has at most one live or signed envelope. A declined or voided one does not block
-- a fresh one.
CREATE UNIQUE INDEX "Envelope_one_open_per_caregiver"
  ON "core"."Envelope" ("agencyId", "caregiverId") WHERE "status" IN ('PREPARING', 'SENT', 'SIGNED');

-- A vendor id exists exactly once the envelope has left PREPARING, and is recorded in the same
-- transaction as its WebhookSubject (ADR-044).
ALTER TABLE "core"."Envelope" ADD CONSTRAINT "Envelope_vendor_id_once_sent"
  CHECK (("status" = 'PREPARING') = ("vendorEnvelopeId" IS NULL));
