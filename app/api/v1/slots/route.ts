import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest } from '@/lib/api/auth'
import * as apiReads from '@/lib/db/api-reads'

export const dynamic = 'force-dynamic'

/** GET /api/v1/slots — open, future teaching slots (read:slots). */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, 'read:slots')
  if (auth instanceof NextResponse) return auth

  const slots = await apiReads.listOpenSlotsForApi(auth.orgId)
  return NextResponse.json({ data: slots })
}
