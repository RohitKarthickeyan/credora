'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Principal } from '@/domain/auth/role'
import {
  type ContextAmbiguity,
  type TemplateIssue,
  templateEditRequestSchema,
} from '@/domain/requirements/template-admin'
import { runAsPrincipal } from '@/server/auth/context'
import { requireStaffSession } from '@/server/auth/session'
import {
  publishRequirementTemplateEdit,
  retireRequirementTemplate,
} from '@/server/requirements/template-admin'
import { scopeLabel } from './scope-label'
import { type TemplateFormValues, readTemplateForm } from './template-form-data'

export type TemplateFormState = {
  readonly error?: string
  readonly fieldErrors?: Readonly<Record<string, string>>
  readonly values?: TemplateFormValues
}

export type RetireState = { readonly error?: string }

type PublishRefusal = Extract<
  Awaited<ReturnType<typeof publishRequirementTemplateEdit>>,
  { ok: false }
>['refusal']

const REFUSALS: Record<Exclude<PublishRefusal['reason'], 'INVALID' | 'AMBIGUOUS'>, string> = {
  NOT_FOUND: 'This requirement no longer exists or has been withdrawn.',
  KEY_IN_USE: 'A requirement with this key already exists. Override or edit it instead.',
  OVERRIDE_EXISTS:
    'Your agency already overrides this rule for this scope. Edit that override instead.',
  RELAXES_MANUAL_ONLY:
    'A New York rule that a person must perform stays manual-only for your agency.',
  RELAXES_BLOCKING: 'A New York rule that blocks clearance keeps blocking clearance for your agency.',
}

const FORM_FIELDS = new Set([
  'key',
  'state',
  'serviceType',
  'role',
  'payer',
  'name',
  'description',
  'type',
  'acceptedEvidence',
  'validityRule',
  'validityMonths',
  'renewalRule',
  'manualOnlyReason',
  'minimumMinutes',
])

function ambiguityMessage(ambiguities: readonly ContextAmbiguity[]): string {
  const cases = ambiguities.map(
    (ambiguity) =>
      `${ambiguity.key} for ${scopeLabel(ambiguity.context)} ` +
      `(${ambiguity.scopes.map(scopeLabel).join(' vs ')})`,
  )
  return (
    `This would leave some caregivers' requirements ambiguous: ${cases.join('; ')}. ` +
    'Add an override for the narrower scope first.'
  )
}

// A request path starts with draft, scope or narrowing; the form names its fields without it.
function issueState(issues: readonly TemplateIssue[]): Pick<TemplateFormState, 'error' | 'fieldErrors'> {
  const fieldErrors: Record<string, string> = {}
  const unplaced: string[] = []

  for (const issue of issues) {
    const segments = issue.path.split('.').filter((segment) => segment !== '')
    if (['draft', 'scope', 'narrowing'].includes(segments[0] ?? '')) segments.shift()
    const [field = '', index] = segments
    const message =
      field === 'acceptedEvidence' && index !== undefined
        ? `Option ${Number(index) + 1}: ${issue.message}`
        : issue.message

    if (!FORM_FIELDS.has(field)) unplaced.push(message)
    else fieldErrors[field] ??= message
  }

  return { fieldErrors, error: unplaced.length > 0 ? unplaced.join(' ') : undefined }
}

function formValues(formData: FormData): TemplateFormValues {
  const values: Record<string, string> = {}
  for (const [name, value] of formData) if (typeof value === 'string') values[name] = value
  return values
}

async function publish(
  principal: Principal,
  request: unknown,
  values: TemplateFormValues,
): Promise<TemplateFormState> {
  const parsed = templateEditRequestSchema.safeParse(request)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    return { ...issueState(issues), values }
  }

  const result = await runAsPrincipal(principal, {}, () =>
    publishRequirementTemplateEdit(parsed.data),
  )
  if (!result.ok) {
    const { refusal } = result
    if (refusal.reason === 'INVALID') return { ...issueState(refusal.issues), values }
    if (refusal.reason === 'AMBIGUOUS') return { error: ambiguityMessage(refusal.ambiguities), values }
    return { error: REFUSALS[refusal.reason], values }
  }

  revalidatePath('/admin/requirements')
  redirect('/admin/requirements')
}

export async function addTemplate(
  _previous: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const { principal } = await requireStaffSession()
  const { key, scope, draft } = readTemplateForm(formData)
  return publish(principal, { kind: 'ADD', key, scope, draft }, formValues(formData))
}

export async function overrideTemplate(
  baseId: string,
  _previous: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const { principal } = await requireStaffSession()
  const { scope, draft } = readTemplateForm(formData)
  return publish(principal, { kind: 'OVERRIDE', baseId, narrowing: scope, draft }, formValues(formData))
}

export async function editTemplate(
  id: string,
  _previous: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const { principal } = await requireStaffSession()
  const { draft } = readTemplateForm(formData)
  return publish(principal, { kind: 'EDIT', id, draft }, formValues(formData))
}

export async function retireTemplate(id: string): Promise<RetireState> {
  const { principal } = await requireStaffSession()
  const result = await runAsPrincipal(principal, {}, () => retireRequirementTemplate({ id }))
  if (!result.ok) {
    const { refusal } = result
    return {
      error:
        refusal.reason === 'NOT_FOUND'
          ? REFUSALS.NOT_FOUND
          : ambiguityMessage(refusal.ambiguities),
    }
  }

  revalidatePath('/admin/requirements')
  return {}
}
