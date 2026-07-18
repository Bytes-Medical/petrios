import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '@/lib/auth'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const orgId = await requireOrg()

    const session = await sessionsDb.findSession(params.id, orgId)
    if (!session || !session.group_code_version || session.group_code_version === 0) {
      return NextResponse.json({ active: false, version: 0, expiresAt: null })
    }

    const verifier = await attendanceDb.findSessionGroupCodeVerifierAsSystem({
      orgId,
      sessionId: session.id,
    })

    return NextResponse.json({
      active: Boolean(
        verifier &&
        session.group_code_enabled &&
        (!session.group_code_expires_at || new Date(session.group_code_expires_at) >= new Date())
      ),
      version: session.group_code_version,
      expiresAt: session.group_code_expires_at,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to get group code',
      },
      { status: 500 }
    )
  }
}
