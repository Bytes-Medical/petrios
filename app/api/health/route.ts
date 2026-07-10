import { NextResponse } from 'next/server'
import { getServiceDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

/**
 * Health check for self-hosted deployments (Docker HEALTHCHECK, load
 * balancers, uptime monitors). Public, no secrets: reports process
 * liveness and database reachability only.
 */
export async function GET() {
  let db: 'ok' | 'error' = 'ok'
  try {
    const client = await getServiceDb()
    const { error } = await client
      .from('organizations')
      .select('id', { count: 'exact', head: true })
    if (error) db = 'error'
  } catch {
    db = 'error'
  }

  return NextResponse.json(
    { status: db === 'ok' ? 'ok' : 'degraded', db },
    { status: db === 'ok' ? 200 : 503 }
  )
}
