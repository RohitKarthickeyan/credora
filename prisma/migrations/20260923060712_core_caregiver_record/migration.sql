-- CreateEnum
CREATE TYPE "core"."PipelineStage" AS ENUM ('INVITED', 'INTAKE', 'SIGNING', 'DOCUMENT_REVIEW', 'VERIFICATION', 'CLEARANCE', 'SYNCING', 'ACTIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "core"."UserRole" AS ENUM ('CAREGIVER', 'COORDINATOR', 'SUPERVISOR', 'AGENCY_ADMIN', 'IMPLEMENTATION');

-- CreateEnum
CREATE TYPE "core"."CertificationLevel" AS ENUM ('PCA', 'HHA', 'CNA');

-- CreateEnum
CREATE TYPE "core"."CredentialType" AS ENUM ('PCA', 'HHA', 'CNA', 'CPR', 'TB_CLEARANCE', 'PHYSICAL');

-- CreateEnum
CREATE TYPE "core"."CredentialVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "core"."Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."User" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "core"."UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Caregiver" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "stage" "core"."PipelineStage" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caregiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."IdentityRecord" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "legalFirstName" TEXT,
    "legalMiddleName" TEXT,
    "legalLastName" TEXT,
    "nameSuffix" TEXT,
    "otherNames" TEXT[],
    "dateOfBirth" DATE,
    "ssnEnc" BYTEA,
    "ssnLast4" TEXT,
    "sex" TEXT,
    "maritalStatus" TEXT,
    "countryOfBirth" TEXT,
    "heightInches" INTEGER,
    "weightPounds" INTEGER,
    "eyeColor" TEXT,
    "hairColor" TEXT,
    "driversLicenseNumber" TEXT,
    "driversLicenseState" TEXT,
    "driversLicenseExpiresAt" DATE,
    "workAuthorizationType" TEXT,
    "workAuthorizationNumberEnc" BYTEA,
    "workAuthorizationExpiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."ContactRecord" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "mobilePhone" TEXT,
    "alternatePhone" TEXT,
    "email" TEXT,
    "preferredLanguage" TEXT,
    "smsConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."HomeCareProfile" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "certificationsHeld" "core"."CertificationLevel"[],
    "clinicalSkills" TEXT[],
    "shiftTypes" TEXT[],
    "serviceAreas" TEXT[],
    "languages" TEXT[],
    "worksWithPets" BOOLEAN,
    "worksWithSmokers" BOOLEAN,
    "hasVehicle" BOOLEAN,
    "covidVaccinationStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeCareProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."CareSettingExperience" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "setting" TEXT NOT NULL,
    "years" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareSettingExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."PayrollInputs" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "hourlyRateCents" INTEGER,
    "overtimeRateCents" INTEGER,
    "payFrequency" TEXT,
    "w4FilingStatus" TEXT,
    "w4MultipleJobs" BOOLEAN,
    "w4DependentsAmountCents" INTEGER,
    "w4OtherIncomeCents" INTEGER,
    "w4DeductionsCents" INTEGER,
    "w4ExtraWithholdingCents" INTEGER,
    "it2104AllowancesNy" INTEGER,
    "it2104AllowancesNyc" INTEGER,
    "it2104AllowancesYonkers" INTEGER,
    "it2104ExtraWithholdingNyCents" INTEGER,
    "it2104ResidentNyc" BOOLEAN,
    "it2104ResidentYonkers" BOOLEAN,
    "bankName" TEXT,
    "bankAccountType" TEXT,
    "bankRoutingNumberEnc" BYTEA,
    "bankAccountNumberEnc" BYTEA,
    "bankAccountLast4" TEXT,
    "directDepositAuthorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollInputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."EmploymentEntry" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "positionTitle" TEXT,
    "supervisorName" TEXT,
    "supervisorPhone" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "startedOn" DATE,
    "endedOn" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "reasonForLeaving" TEXT,
    "mayContact" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."EducationEntry" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "programOrDegree" TEXT,
    "completedOn" DATE,
    "graduated" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Reference" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT,
    "employerName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."EmergencyContact" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "alternatePhone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Credential" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "type" "core"."CredentialType" NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issuedOn" DATE,
    "expiresAt" DATE,
    "verificationStatus" "core"."CredentialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."SignedDocument" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "signedPdfKey" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "core"."User"("email");

-- CreateIndex
CREATE INDEX "User_agencyId_idx" ON "core"."User"("agencyId");

-- CreateIndex
CREATE INDEX "Caregiver_agencyId_stage_idx" ON "core"."Caregiver"("agencyId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Caregiver_agencyId_id_key" ON "core"."Caregiver"("agencyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityRecord_agencyId_caregiverId_key" ON "core"."IdentityRecord"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "ContactRecord_agencyId_email_idx" ON "core"."ContactRecord"("agencyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ContactRecord_agencyId_caregiverId_key" ON "core"."ContactRecord"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeCareProfile_agencyId_caregiverId_key" ON "core"."HomeCareProfile"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "CareSettingExperience_agencyId_caregiverId_setting_key" ON "core"."CareSettingExperience"("agencyId", "caregiverId", "setting");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollInputs_agencyId_caregiverId_key" ON "core"."PayrollInputs"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "EmploymentEntry_agencyId_caregiverId_idx" ON "core"."EmploymentEntry"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "EducationEntry_agencyId_caregiverId_idx" ON "core"."EducationEntry"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "Reference_agencyId_caregiverId_idx" ON "core"."Reference"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "EmergencyContact_agencyId_caregiverId_idx" ON "core"."EmergencyContact"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "Credential_agencyId_caregiverId_idx" ON "core"."Credential"("agencyId", "caregiverId");

-- CreateIndex
CREATE INDEX "Credential_agencyId_expiresAt_idx" ON "core"."Credential"("agencyId", "expiresAt");

-- CreateIndex
CREATE INDEX "SignedDocument_agencyId_caregiverId_idx" ON "core"."SignedDocument"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "SignedDocument_agencyId_envelopeId_templateKey_key" ON "core"."SignedDocument"("agencyId", "envelopeId", "templateKey");

-- AddForeignKey
ALTER TABLE "core"."User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Caregiver" ADD CONSTRAINT "Caregiver_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."IdentityRecord" ADD CONSTRAINT "IdentityRecord_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."ContactRecord" ADD CONSTRAINT "ContactRecord_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."HomeCareProfile" ADD CONSTRAINT "HomeCareProfile_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."CareSettingExperience" ADD CONSTRAINT "CareSettingExperience_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."PayrollInputs" ADD CONSTRAINT "PayrollInputs_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EmploymentEntry" ADD CONSTRAINT "EmploymentEntry_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EducationEntry" ADD CONSTRAINT "EducationEntry_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Reference" ADD CONSTRAINT "Reference_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EmergencyContact" ADD CONSTRAINT "EmergencyContact_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Credential" ADD CONSTRAINT "Credential_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."SignedDocument" ADD CONSTRAINT "SignedDocument_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
