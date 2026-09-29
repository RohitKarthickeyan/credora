import type { RequirementTemplate } from '@/domain/requirements/template'

type Axis = 'state' | 'serviceType' | 'role' | 'payer'

// Raw field values by input name, the shape a form is prefilled from.
export type TemplateFormValues = Readonly<Record<string, string>>

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === 'string' && value !== '' ? value : null
}

function whole(formData: FormData, name: string): number | null {
  const value = text(formData, name)
  return value === null ? null : Number(value)
}

function evidenceIndices(formData: FormData): number[] {
  const indices = new Set<number>()
  for (const name of formData.keys()) {
    const index = /^evidence\.(\d+)\./.exec(name)?.[1]
    if (index !== undefined) indices.add(Number(index))
  }
  return [...indices].sort((a, b) => a - b)
}

/** Reads the template form into the request shape. It does no validation: the schema does. */
export function readTemplateForm(formData: FormData): {
  key: string
  scope: Record<Axis, string | null>
  draft: Record<string, unknown>
} {
  const type = text(formData, 'type')
  const manualOnly = formData.has('manualOnly')

  return {
    key: text(formData, 'key') ?? '',
    scope: {
      state: text(formData, 'state'),
      serviceType: text(formData, 'serviceType'),
      role: text(formData, 'role'),
      payer: text(formData, 'payer'),
    },
    draft: {
      name: text(formData, 'name'),
      description: text(formData, 'description'),
      type,
      acceptedEvidence: evidenceIndices(formData)
        .map((index) => ({
          kind: text(formData, `evidence.${index}.kind`),
          evidenceKey: text(formData, `evidence.${index}.evidenceKey`),
          label: text(formData, `evidence.${index}.label`),
        }))
        .filter((row) => row.kind !== null || row.evidenceKey !== null || row.label !== null),
      validityRule: text(formData, 'validityRule'),
      validityMonths: whole(formData, 'validityMonths'),
      renewalRule: text(formData, 'renewalRule'),
      minimumMinutes: type === 'TRAINING' ? whole(formData, 'minimumMinutes') : null,
      blocksClearance: formData.has('blocksClearance'),
      manualOnly,
      manualOnlyReason: manualOnly ? text(formData, 'manualOnlyReason') : null,
    },
  }
}

export function toFormValues(template: RequirementTemplate): TemplateFormValues {
  const values: Record<string, string> = {
    key: template.key,
    name: template.name,
    description: template.description,
    type: template.type,
    validityRule: template.validityRule,
    validityMonths: template.validityMonths === null ? '' : String(template.validityMonths),
    renewalRule: template.renewalRule,
    manualOnlyReason: template.manualOnlyReason ?? '',
    minimumMinutes: template.minimumMinutes === null ? '' : String(template.minimumMinutes),
  }
  if (template.blocksClearance) values.blocksClearance = 'on'
  if (template.manualOnly) values.manualOnly = 'on'
  template.acceptedEvidence.forEach((option, index) => {
    values[`evidence.${index}.kind`] = option.kind
    values[`evidence.${index}.evidenceKey`] = option.evidenceKey
    values[`evidence.${index}.label`] = option.label
  })
  return values
}
