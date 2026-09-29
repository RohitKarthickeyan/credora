import { INTAKE_REQUIREMENT_KEYS } from '@/domain/requirements/vocabulary'
import { CERTIFICATION_LEVELS } from '../canonical-record'
import type { FormSection } from '../definition'

const REQUIRED_BY = [INTAKE_REQUIREMENT_KEYS.HOME_CARE_PROFILE] as const

const CERTIFICATION_LABELS: Record<(typeof CERTIFICATION_LEVELS)[number], string> = {
  PCA: 'Personal Care Aide (PCA)',
  HHA: 'Home Health Aide (HHA)',
  CNA: 'Certified Nursing Assistant (CNA)',
}

const CERTIFICATION_OPTIONS = CERTIFICATION_LEVELS.map((value) => ({
  value,
  label: CERTIFICATION_LABELS[value],
}))

const CARE_SETTING_OPTIONS = [
  { value: 'HOME_CARE', label: 'Private homes' },
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'NURSING_HOME', label: 'Nursing home' },
  { value: 'ASSISTED_LIVING', label: 'Assisted living' },
  { value: 'HOSPICE', label: 'Hospice' },
  { value: 'ADULT_DAY_PROGRAM', label: 'Adult day program' },
] as const

const CLINICAL_SKILL_OPTIONS = [
  { value: 'PERSONAL_CARE', label: 'Bathing, grooming and dressing' },
  { value: 'TOILETING', label: 'Toileting and incontinence care' },
  { value: 'TRANSFERS', label: 'Transfers and mobility, including a Hoyer lift' },
  { value: 'FEEDING', label: 'Help with eating' },
  { value: 'MEDICATION_REMINDERS', label: 'Medication reminders' },
  { value: 'VITAL_SIGNS', label: 'Taking vital signs' },
  { value: 'CATHETER_CARE', label: 'Catheter care' },
  { value: 'OSTOMY_CARE', label: 'Ostomy care' },
  { value: 'DEMENTIA_CARE', label: "Dementia and Alzheimer's care" },
  { value: 'RANGE_OF_MOTION', label: 'Range-of-motion exercises' },
  { value: 'MEAL_PREPARATION', label: 'Meal preparation' },
  { value: 'HOUSEKEEPING', label: 'Light housekeeping' },
] as const

const SHIFT_TYPE_OPTIONS = [
  { value: 'DAY', label: 'Days' },
  { value: 'EVENING', label: 'Evenings' },
  { value: 'OVERNIGHT', label: 'Overnights' },
  { value: 'WEEKEND', label: 'Weekends' },
  { value: 'LIVE_IN', label: 'Live-in' },
] as const

const SERVICE_AREA_OPTIONS = [
  { value: 'BRONX', label: 'Bronx' },
  { value: 'BROOKLYN', label: 'Brooklyn' },
  { value: 'MANHATTAN', label: 'Manhattan' },
  { value: 'QUEENS', label: 'Queens' },
  { value: 'STATEN_ISLAND', label: 'Staten Island' },
  { value: 'NASSAU', label: 'Nassau County' },
  { value: 'SUFFOLK', label: 'Suffolk County' },
  { value: 'WESTCHESTER', label: 'Westchester County' },
] as const

export const LANGUAGE_OPTIONS = [
  { value: 'ENGLISH', label: 'English' },
  { value: 'SPANISH', label: 'Spanish' },
  { value: 'MANDARIN', label: 'Chinese (Mandarin)' },
  { value: 'CANTONESE', label: 'Chinese (Cantonese)' },
  { value: 'RUSSIAN', label: 'Russian' },
  { value: 'HAITIAN_CREOLE', label: 'Haitian Creole' },
  { value: 'BENGALI', label: 'Bengali' },
  { value: 'KOREAN', label: 'Korean' },
  { value: 'POLISH', label: 'Polish' },
  { value: 'FRENCH', label: 'French' },
  { value: 'ARABIC', label: 'Arabic' },
  { value: 'YIDDISH', label: 'Yiddish' },
  { value: 'ITALIAN', label: 'Italian' },
  { value: 'URDU', label: 'Urdu' },
  { value: 'TAGALOG', label: 'Tagalog' },
] as const

const COVID_STATUS_OPTIONS = [
  { value: 'VACCINATED', label: 'I have had a COVID-19 vaccine' },
  { value: 'NOT_VACCINATED', label: 'I have not had a COVID-19 vaccine' },
  { value: 'PREFER_NOT_TO_SAY', label: 'I prefer not to say' },
] as const

export const HOME_CARE_PROFILE_SECTIONS: readonly FormSection[] = [
  {
    id: 'home-care-certifications',
    title: 'Certifications and experience',
    requiredBy: REQUIRED_BY,
    items: [
      {
        kind: 'multiSelect',
        id: 'certificationsHeld',
        label: 'Which aide certifications do you hold?',
        hint: 'Leave this blank if you do not hold one yet.',
        optional: true,
        options: CERTIFICATION_OPTIONS,
      },
      {
        kind: 'group',
        id: 'careSettingExperience',
        label: 'Where have you worked as a caregiver?',
        itemLabel: 'care setting',
        min: 0,
        max: CARE_SETTING_OPTIONS.length,
        fields: [
          { kind: 'select', id: 'setting', label: 'Care setting', options: CARE_SETTING_OPTIONS },
          {
            kind: 'integer',
            id: 'years',
            label: 'Years in this setting',
            hint: 'Whole years. Enter 0 for less than a year.',
            min: 0,
            max: 60,
          },
        ],
      },
    ],
  },
  {
    id: 'home-care-skills',
    title: 'Clinical skills',
    requiredBy: REQUIRED_BY,
    items: [
      {
        kind: 'multiSelect',
        id: 'clinicalSkills',
        label: 'Which of these have you done for a client?',
        hint: 'Choose all that apply.',
        optional: true,
        options: CLINICAL_SKILL_OPTIONS,
      },
    ],
  },
  {
    id: 'home-care-availability',
    title: 'When and where you can work',
    requiredBy: REQUIRED_BY,
    items: [
      { kind: 'multiSelect', id: 'shiftTypes', label: 'Which shifts can you work?', options: SHIFT_TYPE_OPTIONS },
      {
        kind: 'multiSelect',
        id: 'serviceAreas',
        label: 'Where are you willing to work?',
        options: SERVICE_AREA_OPTIONS,
      },
      { kind: 'yesNo', id: 'hasVehicle', label: 'Do you have a car you can use to get to clients?' },
    ],
  },
  {
    id: 'home-care-preferences',
    title: 'Clients and languages',
    requiredBy: REQUIRED_BY,
    items: [
      { kind: 'yesNo', id: 'worksWithPets', label: 'Can you work in a home with pets?' },
      { kind: 'yesNo', id: 'worksWithSmokers', label: 'Can you work in a home where someone smokes?' },
      {
        kind: 'multiSelect',
        id: 'languages',
        label: 'Which languages can you speak with a client?',
        options: LANGUAGE_OPTIONS,
      },
    ],
  },
  {
    id: 'home-care-covid',
    title: 'COVID-19 vaccination',
    requiredBy: REQUIRED_BY,
    items: [
      {
        kind: 'select',
        id: 'covidVaccinationStatus',
        label: 'What is your COVID-19 vaccination status?',
        options: COVID_STATUS_OPTIONS,
      },
    ],
  },
]
