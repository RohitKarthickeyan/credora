import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { createMockEsign } from '@/integrations/adapters/esign/mock'
import { getPort } from '@/integrations/registry'
import { env } from '@/lib/env'

const esign = createMockEsign({ storage: getPort('storage') })

const lastDelivery = new Map<string, string>()

export default async function MockSigningPage({ params }: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = await params
  const view = await esign.getSigningView(envelopeId)
  if (view === null) notFound()

  async function sign() {
    'use server'
    // Exempt from the authenticate → authorize → validate → use case sequence: this page stands
    // in for the e-sign vendor and has no production endpoint (ADR-011).
    const result = await esign.signEnvelope(envelopeId, new Date().toISOString())
    if (result.signed) {
      try {
        const response = await fetch(new URL('/api/webhooks/esign', env.APP_URL), {
          method: 'POST',
          headers: { ...result.delivery.headers, 'content-type': 'application/json' },
          body: result.delivery.rawBody,
        })
        lastDelivery.set(envelopeId, `delivered: HTTP ${response.status}`)
      } catch (error) {
        lastDelivery.set(envelopeId, `not delivered: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    revalidatePath(`/dev/esign/${envelopeId}`)
  }

  const delivery = lastDelivery.get(envelopeId)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Mock e-signature</h1>
      <p className="text-sm text-ink-muted">
        This page stands in for the e-sign vendor. Its signatures are not legally binding.
      </p>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-ink-muted">Envelope</h2>
        <p className="font-mono text-sm break-all">{view.envelopeId}</p>
        <p className="text-sm">Status: {view.status}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-ink-muted">Signers</h2>
        <ul className="text-sm">
          {view.signers.map((signer) => (
            <li key={signer.email}>
              {signer.fullName} ({signer.role})
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-ink-muted">Documents</h2>
        <ul className="list-disc pl-5 text-sm">
          {view.documentNames.map((name, index) => (
            <li key={index}>{name}</li>
          ))}
        </ul>
      </section>

      {view.status === 'sent' ? (
        <form action={sign}>
          <button type="submit" className="min-h-11 w-full rounded-md border border-border px-4 text-sm font-medium">
            Sign all {view.documentNames.length} documents
          </button>
        </form>
      ) : (
        delivery !== undefined && <p className="font-mono text-sm">Webhook {delivery}</p>
      )}
    </main>
  )
}
