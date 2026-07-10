import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, apiError } from '@/lib/api/auth'
import * as apiReads from '@/lib/db/api-reads'

export const dynamic = 'force-dynamic'

/** GET /api/v1/sessions/[id]/attendance (read:attendance) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request, 'read:attendance')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  // Org check first so attendance for other orgs' sessions can't be read.
  const session = await apiReads.findSessionForApi(auth.orgId, id)
  if (!session) return apiError(404, 'not_found', 'Session not found')

  const rows = await apiReads.listAttendanceForApi(id)
  return NextResponse.json({
    data: rows.map((row) => ({
      user_id: row.user_id,
      external_email: row.external_email,
      status: row.status,
      primary_source: row.primary_source,
      first_evidence_at: row.first_evidence_at,
    })),
  })
}
