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

/**
 * True only for an explicit "false". The staging Worker sets it because it
 * shares the production database while Render still runs the jobs; Render
 * leaves it unset.
 */
export function cronDisabledByConfig(value: string | undefined): boolean {
  return value === 'false'
}

/** Returns the 401/503 to send, or null when the request may run the job. */
export function unauthorizedCronResponse(request: NextRequest): NextResponse | null {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (cronDisabledByConfig(process.env.CRON_ENABLED)) {
    return NextResponse.json({ error: 'Cron jobs are disabled on this deployment' }, { status: 503 })
  }
  return null
}
