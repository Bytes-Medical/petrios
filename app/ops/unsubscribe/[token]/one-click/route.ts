import { verifyUnsubToken } from '@/lib/ops/newsletter'
import * as opsDb from '@/lib/db/ops'

export const dynamic = 'force-dynamic'

/**
 * RFC 8058 one-click unsubscribe target, named by the newsletter's
 * `List-Unsubscribe` / `List-Unsubscribe-Post` headers. Mailbox providers POST
 * `List-Unsubscribe=One-Click`; a GET (or a link scanner) changes nothing.
 * PUBLIC (proxy.ts): the HMAC token is the only credential.
 */
export async function POST(
  request: Request,
  props: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await props.params
  const verified = verifyUnsubToken(token)
  if (!verified) return new Response('Invalid unsubscribe link', { status: 404 })

  const body = await request.text().catch(() => '')
  if (!body.includes('List-Unsubscribe=One-Click')) {
    return new Response('Expected List-Unsubscribe=One-Click', { status: 400 })
  }

  try {
    await opsDb.insertNewsletterOptout(verified.orgId, verified.userId)
  } catch (error) {
    console.error('Failed to record one-click newsletter opt-out:', error)
    return new Response('Could not record the preference; try again later', { status: 503 })
  }
  return new Response('Unsubscribed', { status: 200 })
}
