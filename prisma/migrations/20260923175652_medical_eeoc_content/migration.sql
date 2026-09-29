/*
  Warnings:

  - Added the required column `submittedAt` to the `EeocRecord` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "medical"."MedicalSection" AS ENUM ('MEDICAL_HISTORY', 'PHYSICAL_CAPABILITY', 'SCREENING_DETAIL');

-- CreateEnum
CREATE TYPE "medical"."MedicalResponse" AS ENUM ('YES', 'NO', 'LIMITED', 'DECLINED_TO_ANSWER');

-- CreateEnum
CREATE TYPE "medical"."MedicalScreeningItem" AS ENUM ('PHYSICAL_EXAM', 'TB_SCREENING', 'IMMUNISATION');

-- CreateEnum
CREATE TYPE "medical"."MedicalScreeningOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "eeoc"."EeocGender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'DECLINE_TO_SELF_IDENTIFY');

-- CreateEnum
CREATE TYPE "eeoc"."EeocRaceEthnicity" AS ENUM ('HISPANIC_OR_LATINO', 'WHITE', 'BLACK_OR_AFRICAN_AMERICAN', 'NATIVE_HAWAIIAN_OR_OTHER_PACIFIC_ISLANDER', 'ASIAN', 'AMERICAN_INDIAN_OR_ALASKA_NATIVE', 'TWO_OR_MORE_RACES', 'DECLINE_TO_SELF_IDENTIFY');

-- AlterTable
ALTER TABLE "eeoc"."EeocRecord" ADD COLUMN     "gender" "eeoc"."EeocGender",
ADD COLUMN     "raceEthnicity" "eeoc"."EeocRaceEthnicity",
ADD COLUMN     "submittedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "medical"."MedicalAnswer" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "section" "medical"."MedicalSection" NOT NULL,
    "questionKey" TEXT NOT NULL,
    "response" "medical"."MedicalResponse" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical"."MedicalScreeningResult" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "item" "medical"."MedicalScreeningItem" NOT NULL,
    "outcome" "medical"."MedicalScreeningOutcome" NOT NULL,
    "resultedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicalAnswer_agencyId_caregiverId_idx" ON "medical"."MedicalAnswer"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalAnswer_agencyId_caregiverId_section_questionKey_key" ON "medical"."MedicalAnswer"("agencyId", "caregiverId", "section", "questionKey");

-- CreateIndex
CREATE INDEX "MedicalScreeningResult_agencyId_caregiverId_idx" ON "medical"."MedicalScreeningResult"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalScreeningResult_agencyId_caregiverId_item_key" ON "medical"."MedicalScreeningResult"("agencyId", "caregiverId", "item");
