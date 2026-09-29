import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { FormSection } from '../definition'

export const EMERGENCY_CONTACTS_SECTION: FormSection = {
  id: 'emergency-contacts',
  title: 'Emergency contacts',
  description: 'Who should we call if something happens to you at work? You can list up to 2 people.',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.EMERGENCY_CONTACTS],
  items: [
    {
      kind: 'group',
      id: 'emergencyContacts',
      label: 'Emergency contacts',
      itemLabel: 'emergency contact',
      min: 0,
      max: 2,
      fields: [
        { kind: 'personName', id: 'fullName', label: 'Full name' },
        { kind: 'text', id: 'relationship', label: 'Relationship to you', maxLength: 60 },
        { kind: 'phone', id: 'phone', label: 'Phone' },
        { kind: 'phone', id: 'alternatePhone', label: 'Other phone', optional: true },
        { kind: 'email', id: 'email', label: 'Email', optional: true },
      ],
    },
  ],
}
