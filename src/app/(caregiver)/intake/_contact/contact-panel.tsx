import { requireCaregiverSession } from '@/server/auth/caregiver-session'
import { runAsPrincipal } from '@/server/auth/context'
import { viewOwnContactPreferences } from '@/server/caregivers/contact-preferences'
import { Card } from '@/ui/card'

export async function ContactPanel() {
  const principal = await requireCaregiverSession()
  const { email } = await runAsPrincipal(principal, {}, () =>
    viewOwnContactPreferences({ caregiverId: principal.caregiverId }),
  )

  return (
    <Card>
      <dl className="flex flex-col gap-1">
        <dt className="text-sm font-semibold text-ink">Email</dt>
        <dd className="flex flex-col gap-1">
          {email ? <span className="break-all text-ink">{email}</span> : null}
          <span className="text-sm text-ink-muted">
            You sign in with this email. To change it, ask your coordinator.
          </span>
        </dd>
      </dl>
    </Card>
  )
}
