import { NextRequest, NextResponse } from 'next/server'

/**
 * Shared guard for /api/cron/* routes. Authentication is a Bearer header —
 * `Authorization: Bearer <CRON_SECRET>` — which is also exactly what Vercel
 * Cron sends when CRON_SECRET is set. Secrets never appear in URLs (query
 * strings leak into access logs, proxies, and copied links), so there is
 * deliberately no query-parameter fallback.
 */

/** Pure check, split out for unit testing. */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret) return false
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/)
  return !!match && match[1] === secret
}

/** Returns the 401 to send, or null when the request is authorized. */
export function unauthorizedCronResponse(request: NextRequest): NextResponse | null {
  if (isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return null
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
