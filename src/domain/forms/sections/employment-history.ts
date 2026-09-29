import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { FormSection } from '../definition'

export const EMPLOYMENT_HISTORY_SECTION: FormSection = {
  id: 'employment-history',
  title: 'Work history',
  description: 'Start with your current or most recent job. List up to 5.',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.EMPLOYMENT_HISTORY],
  items: [
    {
      kind: 'group',
      id: 'employment',
      label: 'Jobs',
      itemLabel: 'employer',
      min: 0,
      max: 5,
      fields: [
        { kind: 'text', id: 'employerName', label: 'Employer name', maxLength: 100 },
        { kind: 'text', id: 'positionTitle', label: 'Your job title', maxLength: 60 },
        { kind: 'address', id: 'address', label: 'Employer address', optional: true },
        { kind: 'personName', id: 'supervisorName', label: "Supervisor's name", optional: true },
        { kind: 'phone', id: 'supervisorPhone', label: "Supervisor's phone", optional: true },
        { kind: 'date', id: 'startedOn', label: 'Start date', hint: 'An approximate date is fine.' },
        { kind: 'yesNo', id: 'isCurrent', label: 'Do you still work here?' },
        {
          kind: 'date',
          id: 'endedOn',
          label: 'End date',
          visibleWhen: { field: 'isCurrent', equals: 'no' },
        },
        {
          kind: 'text',
          id: 'reasonForLeaving',
          label: 'Why did you leave?',
          maxLength: 200,
          visibleWhen: { field: 'isCurrent', equals: 'no' },
        },
        { kind: 'yesNo', id: 'mayContact', label: 'May we contact this employer?' },
      ],
    },
  ],
}
