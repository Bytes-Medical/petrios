import { NextRequest, NextResponse } from 'next/server'

/**
 * Shared guard for /api/cron/* routes, which authenticate with
 * ?secret=CRON_SECRET. Returns the 401 response to send, or null when the
 * request is authorized — one place to harden if the scheme ever changes.
 */
export function unauthorizedCronResponse(request: NextRequest): NextResponse | null {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
