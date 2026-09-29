-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "eeoc";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "medical";

-- CreateTable
CREATE TABLE "medical"."MedicalFile" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eeoc"."EeocRecord" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EeocRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicalFile_caregiverId_key" ON "medical"."MedicalFile"("caregiverId");

-- CreateIndex
CREATE INDEX "MedicalFile_agencyId_idx" ON "medical"."MedicalFile"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "EeocRecord_caregiverId_key" ON "eeoc"."EeocRecord"("caregiverId");

-- CreateIndex
CREATE INDEX "EeocRecord_agencyId_idx" ON "eeoc"."EeocRecord"("agencyId");
