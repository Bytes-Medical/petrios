import { NextResponse } from 'next/server'
import { installationReadiness } from '@/lib/self-hosting/readiness'
export const dynamic = 'force-dynamic'
export async function GET() {
  const ready = Object.values(await installationReadiness()).every(Boolean)
  return NextResponse.json({ status: ready ? 'ready' : 'unavailable' }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
