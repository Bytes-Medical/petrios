import { Card } from '@/components/Card'
import { verifyUnsubToken } from '@/lib/ops/newsletter'
import * as opsDb from '@/lib/db/ops'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC newsletter unsubscribe (listed in middleware.ts). The token is an
 * HMAC over orgId+userId signed with the server-only service key, so links
 * work without a login but cannot be forged or enumerated. One click
 * opts out — the standard expectation for email unsubscribe links.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: { token: string }
}) {
  const verified = verifyUnsubToken(params.token)

  if (!verified) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card variant="raised" className="max-w-md">
          <h1 className="mb-2 font-mono text-xl font-bold">Invalid link</h1>
          <p className="font-mono text-sm text-gray-600">
            This unsubscribe link isn&apos;t valid. Please use the link from
            the most recent newsletter email.
          </p>
        </Card>
      </div>
    )
  }

  let ok = true
  try {
    await opsDb.insertNewsletterOptout(verified.orgId, verified.userId)
  } catch (err) {
    console.error('Failed to record newsletter opt-out:', err)
    ok = false
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card variant="raised" className="max-w-md">
        <h1 className="mb-2 font-mono text-xl font-bold">
          {ok ? 'You’re unsubscribed' : 'Something went wrong'}
        </h1>
        <p className="font-mono text-sm text-gray-600">
          {ok
            ? 'You won’t receive the weekly teaching digest any more. Session invitations and reminders are unaffected.'
            : 'We couldn’t record your preference just now — please try the link again in a moment.'}
        </p>
      </Card>
    </div>
  )
}
