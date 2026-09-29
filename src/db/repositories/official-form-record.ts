import { type OfficialFormRecord, officialFormRecordSchema } from '@/domain/documents/official-form'
import type { AgencyModel } from '../generated/models/Agency'
import type { ContactRecordModel } from '../generated/models/ContactRecord'
import type { IdentityRecordModel } from '../generated/models/IdentityRecord'
import type { PayrollInputsModel } from '../generated/models/PayrollInputs'
import { fromAddressColumns } from '../mapping/address'
import { fromDateColumn } from '../mapping/date-only'
import { prisma } from '../prisma'

type RecordRow = {
  agency: Pick<AgencyModel, 'name'>
  identity: Pick<
    IdentityRecordModel,
    | 'legalFirstName'
    | 'legalMiddleName'
    | 'legalLastName'
    | 'nameSuffix'
    | 'otherNames'
    | 'dateOfBirth'
    | 'sex'
    | 'countryOfBirth'
    | 'heightInches'
    | 'weightPounds'
    | 'eyeColor'
    | 'hairColor'
    | 'workAuthorizationType'
    | 'workAuthorizationExpiresAt'
  > | null
  contact: Pick<ContactRecordModel, 'line1' | 'line2' | 'city' | 'state' | 'zip'> | null
  payrollInputs: Pick<
    PayrollInputsModel,
    | 'hourlyRateCents'
    | 'overtimeRateCents'
    | 'w4FilingStatus'
    | 'w4MultipleJobs'
    | 'w4DependentsAmountCents'
    | 'w4OtherIncomeCents'
    | 'w4DeductionsCents'
    | 'w4ExtraWithholdingCents'
    | 'it2104FilingStatus'
    | 'it2104ResidentNyc'
    | 'it2104ResidentYonkers'
    | 'it2104AllowancesNy'
    | 'it2104AllowancesNyc'
    | 'it2104ExtraWithholdingNyCents'
    | 'bankName'
    | 'bankAccountType'
  > | null
}

// A stored code outside its vocabulary throws here: that is corruption, not a refusal.
function toRecord(row: RecordRow): OfficialFormRecord {
  const identity = row.identity
  const payroll = row.payrollInputs
  const address = row.contact === null ? null : fromAddressColumns(row.contact)

  return officialFormRecordSchema.parse({
    agencyName: row.agency.name,
    legalFirstName: identity?.legalFirstName ?? null,
    legalMiddleName: identity?.legalMiddleName ?? null,
    legalLastName: identity?.legalLastName ?? null,
    nameSuffix: identity?.nameSuffix ?? null,
    otherNames: identity?.otherNames ?? [],
    dateOfBirth: fromDateColumn(identity?.dateOfBirth ?? null),
    sex: identity?.sex ?? null,
    countryOfBirth: identity?.countryOfBirth ?? null,
    heightInches: identity?.heightInches ?? null,
    weightPounds: identity?.weightPounds ?? null,
    eyeColor: identity?.eyeColor ?? null,
    hairColor: identity?.hairColor ?? null,
    workAuthorizationType: identity?.workAuthorizationType ?? null,
    workAuthorizationExpiresAt: fromDateColumn(identity?.workAuthorizationExpiresAt ?? null),
    address: address?.status === 'complete' ? address.address : null,
    hourlyRateCents: payroll?.hourlyRateCents ?? null,
    overtimeRateCents: payroll?.overtimeRateCents ?? null,
    w4FilingStatus: payroll?.w4FilingStatus ?? null,
    w4MultipleJobs: payroll?.w4MultipleJobs ?? null,
    w4DependentsAmountCents: payroll?.w4DependentsAmountCents ?? null,
    w4OtherIncomeCents: payroll?.w4OtherIncomeCents ?? null,
    w4DeductionsCents: payroll?.w4DeductionsCents ?? null,
    w4ExtraWithholdingCents: payroll?.w4ExtraWithholdingCents ?? null,
    it2104FilingStatus: payroll?.it2104FilingStatus ?? null,
    it2104ResidentNyc: payroll?.it2104ResidentNyc ?? null,
    it2104ResidentYonkers: payroll?.it2104ResidentYonkers ?? null,
    it2104AllowancesNy: payroll?.it2104AllowancesNy ?? null,
    it2104AllowancesNyc: payroll?.it2104AllowancesNyc ?? null,
    it2104ExtraWithholdingNyCents: payroll?.it2104ExtraWithholdingNyCents ?? null,
    bankName: payroll?.bankName ?? null,
    bankAccountType: payroll?.bankAccountType ?? null,
  })
}

// Explicit selects only: the envelopes stay sealed here; readSealedFormValues is the one door.
export async function findOfficialFormRecord(
  agencyId: string,
  caregiverId: string,
): Promise<OfficialFormRecord | null> {
  const row = await prisma.caregiver.findFirst({
    where: { agencyId, id: caregiverId },
    select: {
      agency: { select: { name: true } },
      identity: {
        select: {
          legalFirstName: true,
          legalMiddleName: true,
          legalLastName: true,
          nameSuffix: true,
          otherNames: true,
          dateOfBirth: true,
          sex: true,
          countryOfBirth: true,
          heightInches: true,
          weightPounds: true,
          eyeColor: true,
          hairColor: true,
          workAuthorizationType: true,
          workAuthorizationExpiresAt: true,
        },
      },
      contact: { select: { line1: true, line2: true, city: true, state: true, zip: true } },
      payrollInputs: {
        select: {
          hourlyRateCents: true,
          overtimeRateCents: true,
          w4FilingStatus: true,
          w4MultipleJobs: true,
          w4DependentsAmountCents: true,
          w4OtherIncomeCents: true,
          w4DeductionsCents: true,
          w4ExtraWithholdingCents: true,
          it2104FilingStatus: true,
          it2104ResidentNyc: true,
          it2104ResidentYonkers: true,
          it2104AllowancesNy: true,
          it2104AllowancesNyc: true,
          it2104ExtraWithholdingNyCents: true,
          bankName: true,
          bankAccountType: true,
        },
      },
    },
  })

  return row === null ? null : toRecord(row)
}
