'use client'

import { toNestErrors } from '@hookform/resolvers'
import { useState } from 'react'
import { FormProvider, type Resolver, useForm, useWatch } from 'react-hook-form'
import type { RawAnswers } from '@/domain/forms/answers'
import type { FormSection } from '@/domain/forms/definition'
import { type SectionIssues, validateSection } from '@/domain/forms/validate'
import { visibleItems } from '@/domain/forms/visibility'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { FormFieldInput } from './form-field'
import { RepeatingGroup } from './repeating-group'

export type AfterSave = 'next' | 'overview'

function issueEntries(issues: SectionIssues): [string, string][] {
  return Object.entries({ ...issues.invalid, ...issues.missing })
}

export function SectionForm({
  section,
  defaultAnswers,
  onSubmit,
}: {
  section: FormSection
  defaultAnswers: RawAnswers
  onSubmit: (answers: RawAnswers, then: AfterSave) => Promise<SectionIssues>
}) {
  const resolver: Resolver<RawAnswers> = (values, _context, options) => {
    const entries = issueEntries(validateSection(section, values, new Date()))
    if (entries.length === 0) return { values, errors: {} }

    const flat = Object.fromEntries(
      entries.map(([path, message]) => [path, { type: 'engine', message }]),
    )
    return { values: {}, errors: toNestErrors(flat, options) }
  }

  const methods = useForm<RawAnswers>({ defaultValues: defaultAnswers, mode: 'onTouched', resolver })
  const answers = useWatch({ control: methods.control })
  const [rejected, setRejected] = useState(false)
  const [saving, setSaving] = useState(false)

  function showIssues(entries: [string, string][]) {
    for (const [path, message] of entries) methods.setError(path, { type: 'server', message })
    setRejected(entries.length > 0)
  }

  // A blank required answer is a draft, not an error: only a malformed one blocks the save.
  async function save(then: AfterSave) {
    const answers = methods.getValues()
    const invalid = Object.entries(validateSection(section, answers, new Date()).invalid)
    if (invalid.length > 0) return showIssues(invalid)
    setSaving(true)
    const issues = await onSubmit(answers, then)
    setSaving(false)
    showIssues(issueEntries(issues))
  }

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save('next')
        }}
        className="flex w-full flex-col gap-6"
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-ink">{section.title}</h1>
          {section.description ? <p className="text-sm text-ink-muted">{section.description}</p> : null}
        </header>
        {rejected ? (
          <Alert tone="danger" live>
            Check the highlighted answers.
          </Alert>
        ) : null}
        {visibleItems(section.items, answers).map((item) =>
          item.kind === 'group' ? (
            <RepeatingGroup key={item.id} group={item} />
          ) : (
            <FormFieldInput key={item.id} field={item} path={item.id} />
          ),
        )}
        <div className="flex flex-col gap-3">
          <Button type="submit" variant="primary" className="w-full" disabled={saving}>
            Save and continue
          </Button>
          <Button variant="secondary" className="w-full" disabled={saving} onClick={() => void save('overview')}>
            Save and finish later
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}
