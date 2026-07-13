import { getServiceDb } from './client'

/**
 * DAL for login_link_requests — the rate-limit log behind the public
 * passwordless sign-in form (policy in lib/rate-limit.ts).
 *
 * Service role justification: the table is deny-all RLS and the caller is
 * unauthenticated by definition (they are trying to sign in), so there is
 * no user context for RLS to scope by. Rows contain only email/IP/timestamp
 * and are pruned after 24 hours.
 */

export async function countRecentLoginLinkRequests(params: {
  email: string
  ip: string | null
  sinceIso: string
}): Promise<{ emailCount: number; ipCount: number }> {
  const db = await getServiceDb()

  const emailQuery = db
    .from('login_link_requests')
    .select('id', { count: 'exact', head: true })
    .eq('email', params.email)
    .gte('requested_at', params.sinceIso)

  const ipQuery = params.ip
    ? db
        .from('login_link_requests')
        .select('id', { count: 'exact', head: true })
        .eq('ip', params.ip)
        .gte('requested_at', params.sinceIso)
    : null

  const [emailResult, ipResult] = await Promise.all([emailQuery, ipQuery])

  if (emailResult.error) throw new Error(emailResult.error.message)
  if (ipResult?.error) throw new Error(ipResult.error.message)

  return {
    emailCount: emailResult.count ?? 0,
    ipCount: ipResult?.count ?? 0,
  }
}

/** Records a request and opportunistically prunes rows older than 24h. */
export async function recordLoginLinkRequest(params: {
  email: string
  ip: string | null
}): Promise<void> {
  const db = await getServiceDb()

  const { error } = await db
    .from('login_link_requests')
    .insert({ email: params.email, ip: params.ip })
  if (error) throw new Error(error.message)

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  // Best-effort prune; a failure here must not block sign-in.
  await db.from('login_link_requests').delete().lt('requested_at', cutoff)
}
