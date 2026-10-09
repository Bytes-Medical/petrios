import { NextRequest, NextResponse } from 'next/server'
import { setupInput, isValidSetupCode } from '@/lib/self-hosting/setup'
import { reserveInstallation, completeInstallation } from '@/lib/db/installation'
import { createBootstrapIdentity } from '@/lib/supabase/bootstrap'
import { getPublicRuntimeConfig } from '@/lib/runtime-config'

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== getPublicRuntimeConfig().appUrl) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  if (Number(request.headers.get('content-length') || 0) > 8192) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  let input
  try {
    const body = await request.text()
    if (body.length > 8192) throw new Error('Request too large')
    input = setupInput.safeParse(JSON.parse(body))
  } catch { return NextResponse.json({ error: 'Invalid setup request' }, { status: 400 }) }
  if (!input.success) return NextResponse.json({ error: 'Check all fields. Use a password of at least 12 characters.' }, { status: 400 })
  const value = input.data
  if (!isValidSetupCode(value.code)) return NextResponse.json({ error: 'Setup code is invalid or setup is disabled.' }, { status: 403 })
  try {
    const reservation = await reserveInstallation(value.email)
    const userId = await createBootstrapIdentity(value.email, value.password, value.name, reservation)
    await completeInstallation(reservation, userId, value.organisation, value.department)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Setup could not complete. Retry with the same administrator email. Completed or existing installations cannot be set up again.' }, { status: 409 })
  }
}
