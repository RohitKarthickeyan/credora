-- AlterTable
ALTER TABLE "core"."AlayaCareSync" ADD COLUMN     "keepOursFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "keepTheirsFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
