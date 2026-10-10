import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { verifyUnsubToken } from '@/lib/ops/newsletter'
import * as opsDb from '@/lib/db/ops'
import {
  confirmNewsletterUnsubscribe,
  resubscribeToNewsletter,
} from '@/app/actions/newsletter-unsubscribe'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC newsletter unsubscribe (listed in proxy.ts). The token is an HMAC
 * over orgId+userId signed with the server-only service key, so links work
 * without a login but cannot be forged or enumerated. Loading this page never
 * changes anything — mail link scanners (e.g. Safe Links) fetch every URL in a
 * message — so the member confirms with a button, and can resubscribe here.
 * Mailbox one-click unsubscribe uses the separate RFC 8058 POST route.
 */
export default async function UnsubscribePage(
  props: {
    params: Promise<{ token: string }>
    searchParams: Promise<{ state?: string }>
  }
) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams])
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

  let optedOut: boolean | null = null
  try {
    optedOut = await opsDb.isNewsletterOptedOut(verified.orgId, verified.userId)
  } catch (err) {
    console.error('Failed to read newsletter preference:', err)
  }
  const failed = optedOut === null || searchParams.state === 'error'

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card variant="raised" className="max-w-md">
        {failed ? (
          <>
            <h1 className="mb-2 font-mono text-xl font-bold">Something went wrong</h1>
            <p role="alert" className="font-mono text-sm text-gray-600">
              We couldn’t read or record your preference just now — please try the link again in a moment.
            </p>
          </>
        ) : optedOut ? (
          <>
            <h1 className="mb-2 font-mono text-xl font-bold">You’re unsubscribed</h1>
            <p className="font-mono text-sm text-gray-600">
              You won’t receive the weekly teaching digest from this organisation any more. Session
              invitations and reminders are unaffected.
            </p>
            <form action={resubscribeToNewsletter} className="mt-4">
              <input type="hidden" name="token" value={params.token} />
              <Button type="submit" variant="secondary">Resubscribe</Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mb-2 font-mono text-xl font-bold">Unsubscribe from the weekly digest?</h1>
            <p className="font-mono text-sm text-gray-600">
              You’ll stop receiving the weekly teaching newsletter from every department in this
              organisation. Session invitations and reminders are unaffected.
            </p>
            <form action={confirmNewsletterUnsubscribe} className="mt-4">
              <input type="hidden" name="token" value={params.token} />
              <Button type="submit">Unsubscribe</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  )
}
