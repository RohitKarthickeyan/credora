-- AlterTable
ALTER TABLE "core"."Agency" ADD COLUMN     "mfaRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "core"."StaffMfa" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totpSecretEnc" BYTEA,
    "enrolledAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."StaffRecoveryCode" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffMfa_userId_key" ON "core"."StaffMfa"("userId");

-- CreateIndex
CREATE INDEX "StaffMfa_agencyId_idx" ON "core"."StaffMfa"("agencyId");

-- CreateIndex
CREATE INDEX "StaffRecoveryCode_agencyId_idx" ON "core"."StaffRecoveryCode"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRecoveryCode_userId_codeHash_key" ON "core"."StaffRecoveryCode"("userId", "codeHash");

-- AddForeignKey
ALTER TABLE "core"."StaffMfa" ADD CONSTRAINT "StaffMfa_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."StaffMfa" ADD CONSTRAINT "StaffMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."StaffRecoveryCode" ADD CONSTRAINT "StaffRecoveryCode_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "core"."Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."StaffRecoveryCode" ADD CONSTRAINT "StaffRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."StaffMfa"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
