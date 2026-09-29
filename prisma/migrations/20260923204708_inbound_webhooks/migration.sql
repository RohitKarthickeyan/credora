-- CreateEnum
CREATE TYPE "core"."WebhookProvider" AS ENUM ('esign', 'backgroundCheck');

-- CreateTable
CREATE TABLE "core"."WebhookSubject" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "provider" "core"."WebhookProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."InboundWebhook" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "provider" "core"."WebhookProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSubject_provider_externalId_key" ON "core"."WebhookSubject"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundWebhook_agencyId_provider_bodySha256_key" ON "core"."InboundWebhook"("agencyId", "provider", "bodySha256");

-- AddForeignKey
ALTER TABLE "core"."WebhookSubject" ADD CONSTRAINT "WebhookSubject_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."InboundWebhook" ADD CONSTRAINT "InboundWebhook_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
