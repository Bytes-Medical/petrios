import { NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/app-url'
import { getInstancePublicKey, isFederationConfigured, TEACHING_RECORD_FORMAT } from '@/lib/federation'

export const dynamic = 'force-dynamic'

/**
 * Instance identity for federation: other Petrios deployments (and
 * anyone verifying an exported teaching record) fetch this to get the
 * public key that signs this instance's records.
 */
export async function GET() {
  if (!isFederationConfigured()) {
    return NextResponse.json(
      { error: 'Federation is not enabled on this instance' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    software: 'bytes-teaching',
    record_format: TEACHING_RECORD_FORMAT,
    instance: getAppUrl(),
    public_key: getInstancePublicKey(),
    verify_url: `${getAppUrl()}/verify/record`,
  })
}
