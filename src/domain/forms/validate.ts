import { z } from 'zod'
import { type Address, addressSchema } from '@/domain/validation/address'
import { bankAccountNumberSchema } from '@/domain/validation/bank-account'
import { dateOfBirthSchema } from '@/domain/validation/date-of-birth'
import { emailSchema } from '@/domain/validation/email'
import { dollarsToCentsSchema, formatCents } from '@/domain/validation/money'
import { personNameSchema } from '@/domain/validation/name'
import { phoneSchema } from '@/domain/validation/phone'
import { routingNumberSchema } from '@/domain/validation/routing-number'
import { ssnSchema } from '@/domain/validation/ssn'
import { workAuthorizationNumberSchema } from '@/domain/validation/work-authorization-number'
import { type FormField, type FormGroup, type FormSection, YES_NO_VALUES } from './definition'
import { visibleItems } from './visibility'

type CanonicalValue =
  | string
  | number
  | boolean
  | readonly string[]
  | Address
  | readonly SectionValues[]
type SectionValues = { readonly [id: string]: CanonicalValue }
export type SectionIssues = {
  readonly invalid: Readonly<Record<string, string>>
  readonly missing: Readonly<Record<string, string>>
}
export type SectionValidation = SectionIssues & { readonly values: SectionValues }

type Issues = { invalid: Record<string, string>; missing: Record<string, string> }
type AddressField = Extract<FormField, { kind: 'address' }>
type ScalarField = Exclude<FormField, AddressField>

// Every message here is a constant or interpolates only a number from the definition, so a
// caregiver's answer can never reach a rendered message or a log.
const REQUIRED = 'This is required.'
const WRONG_TYPE = 'Enter a valid answer.'

const answersSchema = z.record(z.string(), z.unknown())
const rawStringsSchema = z.array(z.string())
const rawAddressSchema = z.object({
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
})
const entriesSchema = z.array(z.unknown())

const ADDRESS_PARTS = ['line1', 'line2', 'city', 'state', 'zip'] as const
const OPTIONAL_ADDRESS_PARTS: ReadonlySet<string> = new Set(['line2'])

function asAnswers(input: unknown): Readonly<Record<string, unknown>> {
  const parsed = answersSchema.safeParse(input)
  return parsed.success ? parsed.data : {}
}

function fieldSchema(field: ScalarField, asOf: Date): z.ZodType<CanonicalValue> {
  switch (field.kind) {
    case 'text':
      return z
        .string()
        .trim()
        .max(field.maxLength, { error: `Keep this to ${field.maxLength} characters or fewer.` })
    case 'email':
      return emailSchema
    case 'phone':
      return phoneSchema
    case 'ssn':
      return ssnSchema
    case 'dateOfBirth':
      return dateOfBirthSchema(asOf)
    case 'date':
      return z.iso.date({ error: 'Enter a date as YYYY-MM-DD.' })
    case 'integer': {
      const range = `Enter a whole number from ${field.min} to ${field.max}.`
      return z
        .string()
        .trim()
        .regex(/^-?\d+$/, { error: range })
        .transform(Number)
        .pipe(z.number().min(field.min, { error: range }).max(field.max, { error: range }))
    }
    case 'select': {
      const values = field.options.map((option) => option.value)
      return z
        .string()
        .trim()
        .refine((value) => values.includes(value), { error: 'Choose one of the listed options.' })
    }
    case 'multiSelect': {
      const values = field.options.map((option) => option.value)
      return rawStringsSchema
        .refine((chosen) => chosen.every((value) => values.includes(value)), {
          error: 'Choose from the listed options.',
        })
        .transform((chosen) => values.filter((value) => chosen.includes(value)))
    }
    case 'yesNo':
      return z.enum(YES_NO_VALUES, { error: 'Choose Yes or No.' }).transform((value) => value === 'yes')
    case 'personName':
      return personNameSchema.shape.first
    case 'nameList':
      return z
        .string()
        .transform((value) => value.split(/[,;\n]/).filter((part) => part.trim() !== ''))
        .pipe(z.array(personNameSchema.shape.first))
        .transform((names) => [...new Set(names)])
        .refine((names) => names.length <= field.maxItems, {
          error: `List up to ${field.maxItems} names.`,
        })
    case 'money':
      return dollarsToCentsSchema.pipe(
        z.number().max(field.maxCents, {
          error: `Enter an amount up to ${formatCents(field.maxCents)}.`,
        }),
      )
    case 'routingNumber':
      return routingNumberSchema
    case 'accountNumber':
      return bankAccountNumberSchema
    case 'documentNumber':
      return workAuthorizationNumberSchema
  }
}

function validateField(
  field: ScalarField,
  input: unknown,
  path: string,
  asOf: Date,
  issues: Issues,
): CanonicalValue | undefined {
  const raw = (field.kind === 'multiSelect' ? rawStringsSchema : z.string()).safeParse(input ?? '')
  if (!raw.success) {
    issues.invalid[path] = WRONG_TYPE
    return undefined
  }

  const blank = typeof raw.data === 'string' ? raw.data.trim() === '' : raw.data.length === 0
  if (blank) {
    if (!field.optional) issues.missing[path] = REQUIRED
    return undefined
  }

  const result = fieldSchema(field, asOf).safeParse(raw.data)
  if (result.success) return result.data
  // Only the first issue: T-004's date-of-birth refinements do not abort, so one bad input can
  // raise several, and a caregiver is shown one message per field.
  issues.invalid[path] = result.error.issues[0]?.message ?? WRONG_TYPE
  return undefined
}

// A partial address is a draft, not an error: each part is judged alone, and only a complete
// address becomes canonical.
function validateAddress(
  field: AddressField,
  input: unknown,
  path: string,
  issues: Issues,
): Address | undefined {
  const raw = rawAddressSchema.safeParse(
    input ?? { line1: '', line2: '', city: '', state: '', zip: '' },
  )
  if (!raw.success) {
    issues.invalid[path] = WRONG_TYPE
    return undefined
  }

  const allBlank = ADDRESS_PARTS.every((part) => raw.data[part].trim() === '')
  if (allBlank && field.optional) return undefined

  let complete = true
  for (const part of ADDRESS_PARTS) {
    const value = raw.data[part]
    if (value.trim() === '') {
      if (!OPTIONAL_ADDRESS_PARTS.has(part)) {
        issues.missing[`${path}.${part}`] = REQUIRED
        complete = false
      }
      continue
    }
    const result = addressSchema.shape[part].safeParse(value)
    if (!result.success) {
      issues.invalid[`${path}.${part}`] = result.error.issues[0]?.message ?? WRONG_TYPE
      complete = false
    }
  }

  return complete ? addressSchema.parse(raw.data) : undefined
}

function validateGroup(
  group: FormGroup,
  input: unknown,
  path: string,
  asOf: Date,
  issues: Issues,
): readonly SectionValues[] | undefined {
  const entries = entriesSchema.safeParse(input ?? [])
  if (!entries.success) {
    issues.invalid[path] = WRONG_TYPE
    return undefined
  }

  const values = entries.data.map((entry, index) =>
    validateScope(group.fields, asAnswers(entry), `${path}.${index}.`, asOf, issues),
  )

  if (values.length < group.min) {
    issues.missing[path] = `Add at least ${group.min}.`
  } else if (group.max !== undefined && values.length > group.max) {
    issues.invalid[path] = `You can add up to ${group.max}.`
  }
  return values
}

function validateScope(
  items: readonly (FormField | FormGroup)[],
  answers: Readonly<Record<string, unknown>>,
  prefix: string,
  asOf: Date,
  issues: Issues,
): SectionValues {
  const values: Record<string, CanonicalValue> = {}

  for (const item of visibleItems(items, answers)) {
    const path = `${prefix}${item.id}`
    const input = answers[item.id]
    const value =
      item.kind === 'group'
        ? validateGroup(item, input, path, asOf, issues)
        : item.kind === 'address'
          ? validateAddress(item, input, path, issues)
          : validateField(item, input, path, asOf, issues)

    if (value !== undefined) values[item.id] = value
  }

  return values
}

export function validateSection(
  section: FormSection,
  answers: unknown,
  asOf: Date,
): SectionValidation {
  const issues: Issues = { invalid: {}, missing: {} }
  const values = validateScope(section.items, asAnswers(answers), '', asOf, issues)
  return { ...issues, values }
}
