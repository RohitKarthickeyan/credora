-- AlterTable
ALTER TABLE "core"."HomeCareProfile" ADD COLUMN     "fluDeclinationReason" TEXT,
ADD COLUMN     "fluVaccinationChoice" TEXT,
ADD COLUMN     "hepatitisBChoice" TEXT;

-- Vaccination statements (T-084): each value set is closed, and a reason exists only on a decline.
ALTER TABLE "core"."HomeCareProfile" ADD CONSTRAINT "HomeCareProfile_hepatitis_b_choice"
  CHECK ("hepatitisBChoice" IS NULL OR "hepatitisBChoice" IN ('CONSENT', 'DECLINE'));
ALTER TABLE "core"."HomeCareProfile" ADD CONSTRAINT "HomeCareProfile_flu_vaccination_choice"
  CHECK ("fluVaccinationChoice" IS NULL OR "fluVaccinationChoice" IN ('VACCINATED', 'DECLINED'));
ALTER TABLE "core"."HomeCareProfile" ADD CONSTRAINT "HomeCareProfile_flu_declination_reason"
  CHECK ("fluDeclinationReason" IS NULL OR "fluVaccinationChoice" = 'DECLINED');
