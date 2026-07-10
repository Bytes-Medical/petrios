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
      return NextResponse.json({ code: null })
    }

    const code = await attendanceDb.callGenerateGroupCode(
      session.id,
      session.group_code_version
    )
    return NextResponse.json({ code: code || 'XXXXXX' })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to get group code',
      },
      { status: 500 }
    )
  }
}
