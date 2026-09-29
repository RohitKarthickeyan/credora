import { SectionForm } from '@/app/(caregiver)/intake/_components/section-form'
import { type RawAnswers, emptyAnswers } from '@/domain/forms/answers'
import { formSectionSchema } from '@/domain/forms/definition'
import { type SectionIssues, validateSection } from '@/domain/forms/validate'

const PREVIEW_SECTION = formSectionSchema.parse({
  id: 'preview',
  title: 'Form engine preview',
  description: 'Every field kind, one conditional field and one repeating group.',
  requiredBy: ['DEV_PREVIEW'],
  items: [
    { kind: 'text', id: 'preferredName', label: 'Preferred name', maxLength: 40 },
    { kind: 'email', id: 'email', label: 'Email' },
    { kind: 'phone', id: 'phone', label: 'Mobile phone' },
    { kind: 'ssn', id: 'ssn', label: 'Social Security number' },
    { kind: 'dateOfBirth', id: 'dob', label: 'Date of birth' },
    { kind: 'date', id: 'availableFrom', label: 'Available from' },
    { kind: 'integer', id: 'yearsExperience', label: 'Years of experience', min: 0, max: 60 },
    {
      kind: 'select',
      id: 'certification',
      label: 'Highest certification',
      options: [
        { value: 'PCA', label: 'PCA' },
        { value: 'HHA', label: 'HHA' },
        { value: 'CNA', label: 'CNA' },
      ],
    },
    {
      kind: 'multiSelect',
      id: 'shifts',
      label: 'Shifts you can work',
      options: [
        { value: 'day', label: 'Day' },
        { value: 'night', label: 'Night' },
        { value: 'liveIn', label: 'Live-in' },
      ],
    },
    { kind: 'yesNo', id: 'hasLicence', label: "Do you have a driver's licence?" },
    {
      kind: 'text',
      id: 'licenceNumber',
      label: 'Licence number',
      maxLength: 20,
      visibleWhen: { field: 'hasLicence', equals: 'yes' },
    },
    { kind: 'address', id: 'homeAddress', label: 'Home address' },
    {
      kind: 'group',
      id: 'references',
      label: 'References',
      itemLabel: 'reference',
      min: 2,
      max: 3,
      fields: [
        { kind: 'text', id: 'name', label: 'Name', maxLength: 80 },
        { kind: 'phone', id: 'phone', label: 'Phone' },
      ],
    },
  ],
})

export default function DevIntakePage() {
  async function check(answers: RawAnswers): Promise<SectionIssues> {
    'use server'
    // Exempt from authenticate → authorize → use case: it reads and writes nothing, and
    // next.config.ts keeps this file out of the production build (ADR-011).
    const { invalid, missing } = validateSection(PREVIEW_SECTION, answers, new Date())
    return { invalid, missing }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[28rem] px-4 py-8">
      <SectionForm section={PREVIEW_SECTION} defaultAnswers={emptyAnswers(PREVIEW_SECTION)} onSubmit={check} />
    </main>
  )
}
