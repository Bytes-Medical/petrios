import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireDepartmentModerator } from '@/lib/auth'
import { getAppUrlFromHeaders } from '@/lib/app-url'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import { formatAppDate } from '@/lib/datetime'
import * as departmentsDb from '@/lib/db/departments'
import * as organizationsDb from '@/lib/db/organizations'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'

export async function GET(request: NextRequest) {
  try {
    await requireAuth()

    const departmentId = request.nextUrl.searchParams.get('departmentId')
    if (!departmentId) {
      return NextResponse.json({ error: 'departmentId required' }, { status: 400 })
    }

    // The department's own organisation (resolved on the server) scopes both
    // the settings read and the organisation name on the preview.
    const { orgId } = await requireDepartmentModerator(departmentId)

    const [dept, orgName] = await Promise.all([
      departmentsDb.findDepartmentCertificateSettings(departmentId, orgId),
      organizationsDb.findOrganizationName(orgId),
    ])

    const baseUrl = await getAppUrlFromHeaders()

    const pdfBuffer = await generateCertificatePDF({
      orgName: orgName || 'Organization',
      departmentName: dept?.name || 'Department',
      sessionTitle: 'Sample Session',
      sessionDate: formatAppDate(new Date()),
      recipientName: 'Jane Doe',
      role: 'Attendee',
      certificateCode: 'PREVIEW',
      issuedDate: formatAppDate(new Date()),
      verifyUrl: `${baseUrl}/verify/PREVIEW`,
      coordinatorNames: resolveTeachingCoordinatorNames(
        dept?.certificate_coordinator_names,
        dept?.lead_name
      ),
    })

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="certificate-preview.pdf"',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate preview',
      },
      { status: 500 }
    )
  }
}
