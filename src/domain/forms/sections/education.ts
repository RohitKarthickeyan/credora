import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { FormSection } from '../definition'

export const EDUCATION_SECTION: FormSection = {
  id: 'education',
  title: 'Education',
  description: 'List up to 3 schools or training programs, including your aide training.',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.EDUCATION],
  items: [
    {
      kind: 'group',
      id: 'education',
      label: 'Schools and programs',
      itemLabel: 'school',
      min: 0,
      max: 3,
      fields: [
        { kind: 'text', id: 'schoolName', label: 'School or program name', maxLength: 100 },
        {
          kind: 'text',
          id: 'programOrDegree',
          label: 'Program, diploma or degree',
          maxLength: 100,
          optional: true,
        },
        { kind: 'text', id: 'city', label: 'City', maxLength: 60, optional: true },
        {
          kind: 'text',
          id: 'state',
          label: 'State, or country if outside the US',
          maxLength: 60,
          optional: true,
        },
        { kind: 'yesNo', id: 'graduated', label: 'Did you complete it?' },
        {
          kind: 'date',
          id: 'completedOn',
          label: 'Date completed',
          optional: true,
          visibleWhen: { field: 'graduated', equals: 'yes' },
        },
      ],
    },
  ],
}
