import type { DocumentTemplate, TemplateBlock } from './agency-document'

// Placeholder until the agency supplies approved wording; replacing it is a data edit plus a
// version bump (T-062 § Risks 1).
const SAMPLE_NOTICE: TemplateBlock = {
  kind: 'paragraph',
  text: 'SAMPLE WORDING — {agencyName} must replace this text with its approved wording before use.',
}

function jobDescription(documentKey: string, role: string): DocumentTemplate {
  return {
    documentKey,
    version: '1',
    title: `${role} Job Description`,
    signOnly: false,
    blocks: [
      SAMPLE_NOTICE,
      {
        kind: 'paragraph',
        text: `A ${role} provides personal care and support to clients in their homes under the direction of the agency's nursing staff, following each client's plan of care.`,
      },
      {
        kind: 'paragraph',
        text: `I, {caregiverLegalName}, have read this ${role} job description and understand the duties it describes.`,
      },
    ],
  }
}

export const AGENCY_TEMPLATES: readonly DocumentTemplate[] = [
  {
    documentKey: 'EMPLOYMENT_APPLICATION',
    version: '1',
    title: 'Employment Application',
    signOnly: false,
    blocks: [
      SAMPLE_NOTICE,
      { kind: 'heading', text: 'Applicant' },
      { kind: 'field', label: 'Legal name', field: 'caregiverLegalName' },
      { kind: 'field', label: 'Address', field: 'caregiverAddress' },
      { kind: 'field', label: 'Mobile phone', field: 'caregiverMobilePhone' },
      { kind: 'heading', text: 'Employment history' },
      { kind: 'history', section: 'employment' },
      { kind: 'heading', text: 'Education' },
      { kind: 'history', section: 'education' },
      { kind: 'heading', text: 'References' },
      { kind: 'history', section: 'references' },
      {
        kind: 'paragraph',
        text: 'I certify that the information in this application is true and complete.',
      },
    ],
  },
  {
    documentKey: 'OFFER_LETTER',
    version: '1',
    title: 'Offer Letter',
    signOnly: false,
    blocks: [
      SAMPLE_NOTICE,
      { kind: 'paragraph', text: '{issuedOn}' },
      { kind: 'paragraph', text: 'Dear {caregiverLegalName},' },
      {
        kind: 'paragraph',
        text: '{agencyName} is pleased to offer you employment at a rate of {hourlyRate} per hour.',
      },
    ],
  },
  jobDescription('HHA_JOB_DESCRIPTION', 'Home Health Aide'),
  jobDescription('PCA_JOB_DESCRIPTION', 'Personal Care Aide'),
  {
    documentKey: 'WORKER_AGREEMENT',
    version: '1',
    title: 'Worker Agreement',
    signOnly: false,
    blocks: [
      SAMPLE_NOTICE,
      {
        kind: 'paragraph',
        text: 'This agreement is between {agencyName} and {caregiverLegalName}, dated {issuedOn}.',
      },
      {
        kind: 'paragraph',
        text: 'By signing, the worker agrees to follow the policies of {agencyName} while employed.',
      },
    ],
  },
  {
    documentKey: 'PHI_ACKNOWLEDGEMENT',
    version: '1',
    title: 'Protected Health Information Acknowledgement',
    signOnly: true,
    blocks: [
      SAMPLE_NOTICE,
      {
        kind: 'paragraph',
        text: "I, {caregiverLegalName}, acknowledge that I have received {agencyName}'s policy on protected health information and will follow it.",
      },
      { kind: 'paragraph', text: 'Issued {issuedOn}.' },
    ],
  },
  // FCRA requires the disclosure in a document that consists solely of it: paragraphs only.
  {
    documentKey: 'FCRA_DISCLOSURE',
    version: '1',
    title: 'Background Check Disclosure and Authorization',
    signOnly: true,
    blocks: [
      SAMPLE_NOTICE,
      {
        kind: 'paragraph',
        text: '{agencyName} may obtain a consumer report about you for employment purposes.',
      },
      {
        kind: 'paragraph',
        text: 'I, {caregiverLegalName}, authorize {agencyName} to obtain a consumer report about me for employment purposes.',
      },
    ],
  },
  {
    documentKey: 'HEPATITIS_B_CONSENT_OR_DECLINATION',
    version: '1',
    title: 'Hepatitis B Vaccine Consent or Declination',
    signOnly: false,
    blocks: [
      SAMPLE_NOTICE,
      { kind: 'paragraph', text: '{agencyName} offers the hepatitis B vaccine to its caregivers.' },
      { kind: 'field', label: 'Decision', field: 'hepatitisBChoice' },
      {
        kind: 'paragraph',
        text: 'I, {caregiverLegalName}, confirm the decision above. Dated {issuedOn}.',
      },
    ],
  },
  {
    documentKey: 'FLU_VACCINATION_STATEMENT',
    version: '1',
    title: 'Flu Vaccination Statement',
    signOnly: false,
    blocks: [
      SAMPLE_NOTICE,
      {
        kind: 'paragraph',
        text: '{agencyName} asks each caregiver for a flu vaccination statement every flu season.',
      },
      { kind: 'field', label: 'Statement', field: 'fluVaccinationChoice' },
      { kind: 'field', label: 'Reason for declining', field: 'fluDeclinationReason' },
      {
        kind: 'paragraph',
        text: 'I, {caregiverLegalName}, confirm the statement above. Dated {issuedOn}.',
      },
    ],
  },
]

export function hasAgencyTemplate(documentKey: string): boolean {
  return AGENCY_TEMPLATES.some((template) => template.documentKey === documentKey)
}
