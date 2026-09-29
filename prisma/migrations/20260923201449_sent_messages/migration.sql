-- CreateEnum
CREATE TYPE "core"."MessageChannel" AS ENUM ('sms', 'email');

-- CreateTable
CREATE TABLE "core"."SentMessage" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "channel" "core"."MessageChannel" NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentMessage_createdAt_idx" ON "core"."SentMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentMessage_agencyId_idempotencyKey_key" ON "core"."SentMessage"("agencyId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "core"."SentMessage" ADD CONSTRAINT "SentMessage_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
