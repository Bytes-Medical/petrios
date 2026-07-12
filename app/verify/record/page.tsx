import { Card } from '@/components/Card'
import { RecordVerifyForm } from '@/components/RecordVerifyForm'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC verification of portable teaching records (federation v1) — under
 * the public /verify/* prefix. Works for records issued by ANY Petrios
 * instance: the signature is checked against the embedded key and
 * cross-checked against the issuer's /.well-known/petrios identity.
 */
export default function VerifyRecordPage() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="font-mono text-2xl font-bold sm:text-3xl">Verify a teaching record</h1>
          <p className="mt-1 font-mono text-sm text-gray-600">
            Teaching records are signed, portable exports of a member&apos;s
            verified teaching history. Paste one below to check it hasn&apos;t
            been altered.
          </p>
        </div>
        <Card variant="raised">
          <RecordVerifyForm />
        </Card>
      </div>
    </div>
  )
}
