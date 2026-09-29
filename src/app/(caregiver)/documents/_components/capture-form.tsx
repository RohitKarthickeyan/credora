'use client'

import { useActionState, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { MAX_UPLOAD_BYTES } from '@/domain/documents/upload'
import type { DocumentRequest } from '@/domain/documents/upload'
import { Alert } from '@/ui/alert'
import { Button } from '@/ui/button'
import { FileField } from '@/ui/file-field'
import { SelectField } from '@/ui/select-field'
import { SubmitButton } from '@/ui/submit-button'
import { uploadDocument } from '../actions'
import { type PhotoIssue, PHOTO_ISSUE_COPY, assessPhoto } from './photo-quality'

const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,application/pdf'
const CHECK_LONG_SIDE = 512

const GUIDANCE = [
  {
    heading: 'Avoid glare',
    lines: [
      'Turn off the flash.',
      'Tilt the paper or phone until no light reflects off it.',
      'Stay out of direct sun and away from lamps overhead.',
    ],
  },
  {
    heading: 'Get the whole document',
    lines: [
      'Lay it flat on a dark surface.',
      'Get all four corners in the picture.',
      'Hold the phone straight above it and fill the frame.',
    ],
  },
]

async function checkPhoto(file: File): Promise<readonly PhotoIssue[]> {
  if (typeof createImageBitmap !== 'function') return []
  // A browser that cannot decode the file (HEIC outside Safari) gets no automated check; the
  // written guidance still stands.
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (bitmap === null) return []

  const scale = Math.min(1, CHECK_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (context === null) return []

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  return assessPhoto(pixels, { width: bitmap.width, height: bitmap.height })
}

export function CaptureForm({
  instanceId,
  options,
}: {
  instanceId: string
  options: DocumentRequest['options']
}) {
  const [state, formAction] = useActionState(uploadDocument, {})
  const [issues, setIssues] = useState<readonly PhotoIssue[]>([])
  const [tooLarge, setTooLarge] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setIssues([])
    const file = event.target.files?.[0]
    // Next rejects a body over bodySizeLimit before the action runs, so it cannot be refused there.
    setTooLarge(file !== undefined && file.size > MAX_UPLOAD_BYTES)
    if (file === undefined || !file.type.startsWith('image/')) return
    setIssues(await checkPhoto(file))
  }

  function retake() {
    const input = formRef.current?.elements.namedItem('file')
    if (!(input instanceof HTMLInputElement)) return
    input.value = ''
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.click()
  }

  const [onlyOption] = options

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6">
      {GUIDANCE.map(({ heading, lines }) => (
        <section key={heading} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-ink">{heading}</h2>
          <ul className="list-disc pl-5 text-ink-muted">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}

      <input type="hidden" name="instanceId" value={instanceId} />
      {options.length > 1 || onlyOption === undefined ? (
        <SelectField
          name="evidenceKey"
          label="Which one is it?"
          options={options.map(({ evidenceKey, label }) => ({ value: evidenceKey, label }))}
        />
      ) : (
        <input type="hidden" name="evidenceKey" value={onlyOption.evidenceKey} />
      )}

      <FileField
        name="file"
        label="Photo or file"
        accept={ACCEPT}
        maxBytes={MAX_UPLOAD_BYTES}
        hint="Take a photo or choose a file"
        onChange={handleFile}
      />

      {issues.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Alert tone="warning" title="Check your photo">
            <ul className="list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{PHOTO_ISSUE_COPY[issue]}</li>
              ))}
            </ul>
          </Alert>
          <Button variant="secondary" onClick={retake}>
            Retake
          </Button>
        </div>
      ) : null}

      {state.error ? (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      ) : null}
      <SubmitButton disabled={tooLarge} pendingLabel="Sending…">Send</SubmitButton>
    </form>
  )
}
