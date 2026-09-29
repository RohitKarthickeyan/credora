import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { EYE_COLORS, HAIR_COLORS } from '../canonical-record'
import type { FormSection } from '../definition'

const EYE_COLOR_LABELS: Record<(typeof EYE_COLORS)[number], string> = {
  BLK: 'Black',
  BLU: 'Blue',
  BRO: 'Brown',
  GRN: 'Green',
  GRY: 'Gray',
  HAZ: 'Hazel',
  MAR: 'Maroon',
  MUL: 'Multicolored',
  PNK: 'Pink',
}

const HAIR_COLOR_LABELS: Record<(typeof HAIR_COLORS)[number], string> = {
  BAL: 'Bald',
  BLK: 'Black',
  BLN: 'Blond',
  BRO: 'Brown',
  GRY: 'Gray',
  RED: 'Red',
  SDY: 'Sandy',
  WHI: 'White',
}

export const CHRC_DESCRIPTORS_SECTION: FormSection = {
  id: 'chrc-descriptors',
  title: 'Fingerprint check details',
  requiredBy: [INTAKE_REQUIREMENT_KEYS.CHRC_DESCRIPTORS],
  items: [
    { kind: 'integer', id: 'heightInches', label: 'Height', hint: 'In inches: 5 ft 6 in is 66.', min: 36, max: 96 },
    { kind: 'integer', id: 'weightPounds', label: 'Weight in pounds', min: 50, max: 700 },
    {
      kind: 'select',
      id: 'eyeColor',
      label: 'Eye color',
      options: EYE_COLORS.map((value) => ({ value, label: EYE_COLOR_LABELS[value] })),
    },
    {
      kind: 'select',
      id: 'hairColor',
      label: 'Hair color',
      options: HAIR_COLORS.map((value) => ({ value, label: HAIR_COLOR_LABELS[value] })),
    },
  ],
}
