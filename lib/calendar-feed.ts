import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Capability token for the public ICS feed (/api/calendar/ics, spec/04).
 * HMAC-SHA256 over a domain-separated label and the organisation id, keyed by
 * a server secret, truncated to 128 bits. It replaces the earlier 32-bit
 * string hash, which was linear in the secret: one valid (org, token) pair let
 * anyone derive the token for every other organisation.
 *
 * Pure (the secret is passed in) so it can be unit-tested and used from both
 * the feed route and the server pages that show the subscription link.
 */
const LABEL = 'petrios:calendar-feed:v2:'
const TOKEN_HEX_LENGTH = 32

export function calendarFeedToken(orgId: string, secret: string): string {
  if (!secret) throw new Error('calendar feed secret is not configured')
  return createHmac('sha256', secret).update(LABEL + orgId).digest('hex').slice(0, TOKEN_HEX_LENGTH)
}

export function verifyCalendarFeedToken(orgId: string, token: string, secret: string): boolean {
  if (!secret || !/^[0-9a-f]{32}$/.test(token)) return false
  const expected = calendarFeedToken(orgId, secret)
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

/** The relative feed path for an organisation (optionally one department). */
export function calendarFeedPath(orgId: string, secret: string, departmentId?: string): string {
  const params = new URLSearchParams({ orgId, token: calendarFeedToken(orgId, secret) })
  if (departmentId) params.set('departmentId', departmentId)
  return `/api/calendar/ics?${params.toString()}`
}

/** Server-side secret: the service-role key, never sent to the browser. */
export function calendarFeedSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}
