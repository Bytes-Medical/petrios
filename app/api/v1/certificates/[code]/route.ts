import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, apiError } from '@/lib/api/auth'
import * as certificatesDb from '@/lib/db/certificates'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/certificates/[code] — programmatic certificate verification
 * (read:certificates). Only certificates belonging to the token's org are
 * confirmed, so a token can't be used to probe other organizations.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await authenticateApiRequest(request, 'read:certificates')
  if (auth instanceof NextResponse) return auth

  const { code } = await params
  const certificate = await certificatesDb.findCertificateByCode(code)
  if (!certificate || certificate.org_id !== auth.orgId) {
    return apiError(404, 'not_found', 'Certificate not found')
  }

  return NextResponse.json({
    data: {
      certificate_code: certificate.certificate_code,
      role: certificate.certificate_role,
      recognition_basis: certificate.recognition_basis ?? null,
      recipient_name: certificate.recipient_name,
      teaching_coordinators: resolveTeachingCoordinatorNames(
        certificate.coordinator_names,
        certificate.departments?.lead_name
      ),
      issued_at: certificate.issued_at,
      session: certificate.sessions
        ? { id: certificate.sessions.id, title: certificate.sessions.title, date_start: certificate.sessions.date_start }
        : null,
      department: certificate.departments
        ? { id: certificate.departments.id, name: certificate.departments.name }
        : null,
      status: certificate.status ?? 'LEGACY',
      valid: certificate.status === 'VALID',
      revoked_at: certificate.revoked_at ?? null,
      revocation_reason: certificate.revocation_reason ?? null,
    },
  })
}
