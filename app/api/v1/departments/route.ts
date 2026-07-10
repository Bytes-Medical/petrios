import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest } from '@/lib/api/auth'
import * as apiReads from '@/lib/db/api-reads'

export const dynamic = 'force-dynamic'

/** GET /api/v1/departments (read:departments) */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, 'read:departments')
  if (auth instanceof NextResponse) return auth

  const departments = await apiReads.listDepartmentsForApi(auth.orgId)
  return NextResponse.json({ data: departments })
}
