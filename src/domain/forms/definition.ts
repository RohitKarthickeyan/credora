import { z } from 'zod'
import { REQUIREMENT_KEY_PATTERN } from '@/domain/requirements/template'

export const FIELD_KINDS = [
  'text', 'email', 'phone', 'ssn', 'dateOfBirth', 'date', 'integer',
  'select', 'multiSelect', 'yesNo', 'address',
  'personName', 'nameList', 'money', 'routingNumber', 'accountNumber', 'documentNumber',
] as const

// No dots: a field's react-hook-form path is its ids joined by dots, so a dot inside an id
// would make `home.address` ambiguous between a field and a group entry.
const FIELD_ID_PATTERN = /^[a-z][A-Za-z0-9]*$/

const fieldId = z.string().regex(FIELD_ID_PATTERN)

// A list means "equals any of".
const visibilityConditionSchema = z.object({
  field: z.string(),
  equals: z.union([z.string(), z.tuple([z.string()], z.string()).readonly()]),
})

const optionsSchema = z
  .array(z.object({ value: z.string(), label: z.string().min(1) }))
  .min(1)
  .readonly()

const fieldBase = {
  id: fieldId,
  label: z.string().min(1),
  hint: z.string().optional(),
  optional: z.literal(true).optional(),
  visibleWhen: visibilityConditionSchema.optional(),
}

const formFieldSchema = z.discriminatedUnion('kind', [
  z.object({ ...fieldBase, kind: z.literal('text'), maxLength: z.int().min(1) }),
  z.object({ ...fieldBase, kind: z.literal('email') }),
  z.object({ ...fieldBase, kind: z.literal('phone') }),
  z.object({ ...fieldBase, kind: z.literal('ssn') }),
  z.object({ ...fieldBase, kind: z.literal('dateOfBirth') }),
  z.object({ ...fieldBase, kind: z.literal('date') }),
  z.object({ ...fieldBase, kind: z.literal('integer'), min: z.int(), max: z.int() }),
  z.object({ ...fieldBase, kind: z.literal('select'), options: optionsSchema }),
  z.object({ ...fieldBase, kind: z.literal('multiSelect'), options: optionsSchema }),
  z.object({ ...fieldBase, kind: z.literal('yesNo') }),
  z.object({ ...fieldBase, kind: z.literal('address') }),
  z.object({ ...fieldBase, kind: z.literal('personName') }),
  z.object({ ...fieldBase, kind: z.literal('nameList'), maxItems: z.int().min(1) }),
  z.object({ ...fieldBase, kind: z.literal('money'), maxCents: z.int().min(1) }),
  z.object({ ...fieldBase, kind: z.literal('routingNumber') }),
  z.object({ ...fieldBase, kind: z.literal('accountNumber') }),
  z.object({ ...fieldBase, kind: z.literal('documentNumber') }),
])

const formGroupSchema = z.object({
  kind: z.literal('group'),
  id: fieldId,
  label: z.string().min(1),
  itemLabel: z.string().min(1),
  min: z.int().min(0),
  max: z.int().min(1).optional(),
  fields: z.array(formFieldSchema).min(1).readonly(),
})

export type FormField = z.infer<typeof formFieldSchema>
export type FormGroup = z.infer<typeof formGroupSchema>

type Issue = { readonly message: string; readonly path: readonly (string | number)[] }

export const YES_NO_VALUES = ['yes', 'no'] as const

function controllerValues(item: FormField | FormGroup): readonly string[] | undefined {
  if (item.kind === 'yesNo') return YES_NO_VALUES
  if (item.kind === 'select') return item.options.map((option) => option.value)
  return undefined
}

function itemIssues(item: FormField | FormGroup, path: readonly (string | number)[]): Issue[] {
  if (item.kind === 'select' || item.kind === 'multiSelect') {
    const values = item.options.map((option) => option.value)
    return new Set(values).size === values.length
      ? []
      : [{ message: 'Option values must be unique.', path: [...path, 'options'] }]
  }
  if (item.kind === 'integer' && item.min > item.max) {
    return [{ message: 'min must not exceed max.', path: [...path, 'max'] }]
  }
  if (item.kind === 'group') {
    const bounds =
      item.max !== undefined && item.max < item.min
        ? [{ message: 'max must be at least min.', path: [...path, 'max'] }]
        : []
    return [...bounds, ...scopeIssues(item.fields, [...path, 'fields'])]
  }
  return []
}

// A condition may only name an earlier sibling, so the dependency graph is acyclic by
// construction and visibility resolves in one ordered pass.
function scopeIssues(
  items: readonly (FormField | FormGroup)[],
  path: readonly (string | number)[],
): Issue[] {
  const earlier = new Map<string, FormField | FormGroup>()

  return items.flatMap((item, index) => {
    const itemPath = [...path, index]
    const issues = itemIssues(item, itemPath)

    if (earlier.has(item.id)) {
      issues.push({ message: `Duplicate id "${item.id}".`, path: [...itemPath, 'id'] })
    }

    const condition = item.kind === 'group' ? undefined : item.visibleWhen
    if (condition) {
      const controller = earlier.get(condition.field)
      const values = controller && controllerValues(controller)
      if (!values) {
        issues.push({
          message: 'visibleWhen must name an earlier select or yesNo field in the same scope.',
          path: [...itemPath, 'visibleWhen', 'field'],
        })
      } else if (
        !(typeof condition.equals === 'string' ? [condition.equals] : condition.equals).every(
          (value) => values.includes(value),
        )
      ) {
        issues.push({
          message: "visibleWhen.equals must be one of the controller's values.",
          path: [...itemPath, 'visibleWhen', 'equals'],
        })
      }
    }

    earlier.set(item.id, item)
    return issues
  })
}

const requirementKey = z.string().regex(REQUIREMENT_KEY_PATTERN)

export const formSectionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    requiredBy: z.tuple([requirementKey], requirementKey).readonly(),
    items: z
      .array(z.discriminatedUnion('kind', [formFieldSchema, formGroupSchema]))
      .min(1)
      .readonly(),
  })
  .superRefine((section, ctx) => {
    for (const issue of scopeIssues(section.items, ['items'])) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] })
    }
  })

export type FormSection = z.infer<typeof formSectionSchema>
