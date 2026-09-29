'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getPort } from '@/integrations/registry'
import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import type { UploadOwnDocumentResult } from '@/server/documents/uploads'
import { uploadOwnDocument } from '@/server/documents/uploads'

type UploadState = { readonly error?: string }

const GENERIC = "We couldn't send that. Choose the photo or file again and press Send."

const COPY: Record<Extract<UploadOwnDocumentResult, { ok: false }>['refusal'], string> = {
  EMPTY: 'Take a photo or choose a file first.',
  TOO_LARGE: 'That file is too big. Take a photo instead, or send a smaller file.',
  UNSUPPORTED_FORMAT: 'We can take a photo, a PDF, or a PNG. Take a photo of the document instead.',
  NOT_FOUND: "We couldn't find that requirement. Go back to your documents and try again.",
  NOT_ACCEPTED: 'Choose which document this is and try again.',
  NOT_OPEN: 'Your agency already has this one. Nothing more is needed.',
}

const uploadSchema = z.object({
  instanceId: z.uuid(),
  evidenceKey: z.string().min(1),
  file: z.instanceof(File),
})

export async function uploadDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const principal = await requireCaregiverSession()
  const parsed = uploadSchema.safeParse({
    instanceId: formData.get('instanceId'),
    evidenceKey: formData.get('evidenceKey'),
    file: formData.get('file'),
  })
  if (!parsed.success) return { error: GENERIC }

  const { instanceId, evidenceKey, file } = parsed.data
  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await runAsPrincipal(principal, {}, () =>
    uploadOwnDocument({
      caregiverId: principal.caregiverId,
      instanceId,
      evidenceKey,
      bytes,
      storage: getPort('storage'),
    }),
  )
  if (!result.ok) return { error: COPY[result.refusal] }

  revalidatePath('/documents')
  redirect('/documents')
}
