-- CreateEnum
CREATE TYPE "core"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "core"."MessageAuthor" AS ENUM ('CAREGIVER', 'AGENT', 'STAFF');

-- CreateTable
CREATE TABLE "core"."Conversation" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "awaitingStep" TEXT,
    "unclearCount" INTEGER NOT NULL DEFAULT 0,
    "pausedAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Message" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "core"."MessageDirection" NOT NULL,
    "author" "core"."MessageAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "ssnEnc" BYTEA,
    "mediaStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_agencyId_caregiverId_key" ON "core"."Conversation"("agencyId", "caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_agencyId_id_key" ON "core"."Conversation"("agencyId", "id");

-- CreateIndex
CREATE INDEX "Message_agencyId_conversationId_createdAt_idx" ON "core"."Message"("agencyId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactRecord_agencyId_mobilePhone_idx" ON "core"."ContactRecord"("agencyId", "mobilePhone");

-- AddForeignKey
ALTER TABLE "core"."Conversation" ADD CONSTRAINT "Conversation_agencyId_caregiverId_fkey" FOREIGN KEY ("agencyId", "caregiverId") REFERENCES "core"."Caregiver"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Message" ADD CONSTRAINT "Message_agencyId_conversationId_fkey" FOREIGN KEY ("agencyId", "conversationId") REFERENCES "core"."Conversation"("agencyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
