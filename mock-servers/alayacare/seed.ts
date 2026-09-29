import type { ProfileAttribute, SeedEmployee, Skill } from './wire'

type Seed = {
  readonly employees: readonly SeedEmployee[]
  readonly profileAttributes: readonly ProfileAttribute[]
  readonly skills: readonly Skill[]
}

export const SEED: Seed = {
  employees: [
    {
      id: 1001,
      external_id: null,
      status: 'active',
      demographics: {
        first_name: 'Maria',
        last_name: 'Santos',
        email: 'maria.santos@example.com',
        birthday: '1980-04-12',
        phone: '+17185550101',
      },
    },
    {
      id: 1002,
      external_id: null,
      status: 'active',
      demographics: {
        first_name: 'James',
        last_name: 'Okafor',
        email: 'james.okafor@example.com',
        birthday: '1975-09-03',
        phone: '+17185550102',
        hire_date: '2019-06-01',
      },
    },
  ],
  profileAttributes: [
    { tag: 'first_name', description: 'First Name', type: 'text' },
    { tag: 'last_name', description: 'Last Name', type: 'text' },
    { tag: 'email', description: 'Email', type: 'text' },
    { tag: 'birthday', description: 'Date of Birth', type: 'date' },
    { tag: 'phone', description: 'Phone', type: 'text' },
    { tag: 'hire_date', description: 'Hire Date', type: 'date' },
    { tag: 'hha_registry_number', description: 'HHA Registry Number', type: 'text' },
    { tag: 'cleared_to_work', description: 'Cleared to Work', type: 'boolean' },
    { tag: 'last_training_date', description: 'Last In-Service Training', type: 'date' },
    { tag: 'languages_spoken', description: 'Languages Spoken', type: 'text' },
  ],
  skills: [
    { id: 1, description: 'Home Health Aide Certificate', label1: 'Certificate Number', label2: 'Issuer', has_date: true, has_acquired_date: true },
    { id: 2, description: 'PPD / TB Test', label1: 'Result', label2: 'Issuer', has_date: true, has_acquired_date: true },
    { id: 3, description: 'CPR Certification', label1: 'Card Number', label2: 'Issuer', has_date: true, has_acquired_date: true },
    { id: 4, description: 'Annual Health Assessment', label1: 'Reference', label2: 'Issuer', has_date: true, has_acquired_date: true },
  ],
}
