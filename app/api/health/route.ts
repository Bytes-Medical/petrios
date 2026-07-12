import { NextResponse } from 'next/server'
import { pingDatabase } from '@/lib/db/organizations'

export const dynamic = 'force-dynamic'

/**
 * Health check for self-hosted deployments (Docker HEALTHCHECK, load
 * balancers, uptime monitors). Public, no secrets: reports process
 * liveness and database reachability only.
 */
export async function GET() {
  const db: 'ok' | 'error' = (await pingDatabase()) ? 'ok' : 'error'

  return NextResponse.json(
    { status: db === 'ok' ? 'ok' : 'degraded', db },
    { status: db === 'ok' ? 200 : 503 }
  )
}
