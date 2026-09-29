import type { AgencyDocumentContext } from '@/domain/documents/agency-document'
import { toFluVaccinationStatement, toHepatitisBChoice } from '@/domain/forms/vaccination'
import type { PersonName } from '@/domain/validation/name'
import type { AgencyModel } from '../generated/models/Agency'
import type { ContactRecordModel } from '../generated/models/ContactRecord'
import type { EducationEntryModel } from '../generated/models/EducationEntry'
import type { EmploymentEntryModel } from '../generated/models/EmploymentEntry'
import type { HomeCareProfileModel } from '../generated/models/HomeCareProfile'
import type { IdentityRecordModel } from '../generated/models/IdentityRecord'
import type { PayrollInputsModel } from '../generated/models/PayrollInputs'
import type { ReferenceModel } from '../generated/models/Reference'
import { fromAddressColumns } from '../mapping/address'
import { fromDateColumn } from '../mapping/date-only'
import { prisma } from '../prisma'

type ContextRow = {
  agency: Pick<AgencyModel, 'name'>
  identity: Pick<
    IdentityRecordModel,
    'legalFirstName' | 'legalMiddleName' | 'legalLastName' | 'nameSuffix'
  > | null
  contact: Pick<
    ContactRecordModel,
    'line1' | 'line2' | 'city' | 'state' | 'zip' | 'mobilePhone'
  > | null
  payrollInputs: Pick<PayrollInputsModel, 'hourlyRateCents'> | null
  homeCareProfile: Pick<
    HomeCareProfileModel,
    'hepatitisBChoice' | 'fluVaccinationChoice' | 'fluDeclinationReason'
  > | null
  employment: Pick<
    EmploymentEntryModel,
    'employerName' | 'positionTitle' | 'startedOn' | 'endedOn' | 'isCurrent'
  >[]
  education: Pick<EducationEntryModel, 'schoolName' | 'programOrDegree' | 'completedOn'>[]
  references: Pick<ReferenceModel, 'fullName' | 'relationship' | 'phone'>[]
}

const CAPTURE_ORDER = [{ createdAt: 'asc' }, { id: 'asc' }] as const

function toLegalName(identity: ContextRow['identity']): PersonName | null {
  if (identity === null || identity.legalFirstName === null || identity.legalLastName === null) {
    return null
  }

  return {
    first: identity.legalFirstName,
    middle: identity.legalMiddleName ?? undefined,
    last: identity.legalLastName,
    suffix: identity.nameSuffix ?? undefined,
  }
}

function toContext(row: ContextRow): AgencyDocumentContext {
  const address = row.contact === null ? null : fromAddressColumns(row.contact)

  return {
    agencyName: row.agency.name,
    legalName: toLegalName(row.identity),
    address: address?.status === 'complete' ? address.address : null,
    mobilePhone: row.contact?.mobilePhone ?? null,
    hourlyRateCents: row.payrollInputs?.hourlyRateCents ?? null,
    hepatitisBChoice: toHepatitisBChoice(row.homeCareProfile?.hepatitisBChoice ?? null),
    fluVaccination: toFluVaccinationStatement(
      row.homeCareProfile?.fluVaccinationChoice ?? null,
      row.homeCareProfile?.fluDeclinationReason ?? null,
    ),
    employment: row.employment.map((job) => ({
      employerName: job.employerName,
      positionTitle: job.positionTitle,
      startedOn: fromDateColumn(job.startedOn),
      endedOn: fromDateColumn(job.endedOn),
      isCurrent: job.isCurrent,
    })),
    education: row.education.map((school) => ({
      schoolName: school.schoolName,
      programOrDegree: school.programOrDegree,
      completedOn: fromDateColumn(school.completedOn),
    })),
    references: row.references.map((reference) => ({
      fullName: reference.fullName,
      relationship: reference.relationship,
      phone: reference.phone,
    })),
  }
}

// Explicit selects only: none of these documents prints an encrypted or Sensitive-only column.
export async function findAgencyDocumentContext(
  agencyId: string,
  caregiverId: string,
): Promise<AgencyDocumentContext | null> {
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
        },
      },
      contact: {
        select: { line1: true, line2: true, city: true, state: true, zip: true, mobilePhone: true },
      },
      payrollInputs: { select: { hourlyRateCents: true } },
      homeCareProfile: {
        select: { hepatitisBChoice: true, fluVaccinationChoice: true, fluDeclinationReason: true },
      },
      employment: {
        select: {
          employerName: true,
          positionTitle: true,
          startedOn: true,
          endedOn: true,
          isCurrent: true,
        },
        orderBy: [...CAPTURE_ORDER],
      },
      education: {
        select: { schoolName: true, programOrDegree: true, completedOn: true },
        orderBy: [...CAPTURE_ORDER],
      },
      references: {
        select: { fullName: true, relationship: true, phone: true },
        orderBy: [...CAPTURE_ORDER],
      },
    },
  })

  return row === null ? null : toContext(row)
}
