import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import type { FormSection } from '../definition'
import { LANGUAGE_OPTIONS } from './home-care-profile'

// email is the sign-in key, set and corrected by staff, so it is not a field here: the contact
// panel shows it read-only.
export const CONTACT_SECTION: FormSection = {
  id: 'contact',
  title: 'How we reach you',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.CONTACT],
  items: [
    { kind: 'address', id: 'address', label: 'Home address' },
    { kind: 'phone', id: 'mobilePhone', label: 'Mobile phone number' },
    {
      kind: 'phone',
      id: 'alternatePhone',
      label: 'Another phone number',
      hint: "A home or work number we can try if we can't reach you on your mobile.",
      optional: true,
    },
    {
      kind: 'select',
      id: 'preferredLanguage',
      label: 'Which language do you prefer we use with you?',
      options: LANGUAGE_OPTIONS,
    },
  ],
}
