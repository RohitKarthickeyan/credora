import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { FormSection } from '../definition'

export const REFERENCES_SECTION: FormSection = {
  id: 'references',
  title: 'References',
  description:
    'Give at least 2 people who know your work, such as a former supervisor. Not family members.',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.REFERENCES],
  items: [
    {
      kind: 'group',
      id: 'references',
      label: 'References',
      itemLabel: 'reference',
      min: 2,
      fields: [
        { kind: 'personName', id: 'fullName', label: 'Full name' },
        {
          kind: 'text',
          id: 'relationship',
          label: 'How do you know them?',
          hint: 'For example: former supervisor.',
          maxLength: 60,
        },
        { kind: 'text', id: 'employerName', label: 'Where they work', maxLength: 100, optional: true },
        { kind: 'phone', id: 'phone', label: 'Phone' },
        { kind: 'email', id: 'email', label: 'Email', optional: true },
      ],
    },
  ],
}
