import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import * as departmentsDb from '@/lib/db/departments'
import * as organizationsDb from '@/lib/db/organizations'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    const orgId = await requireOrg()

    const departmentId = request.nextUrl.searchParams.get('departmentId')
    if (!departmentId) {
      return NextResponse.json({ error: 'departmentId required' }, { status: 400 })
    }

    await requireDepartmentModerator(departmentId)

    const [dept, orgName] = await Promise.all([
      departmentsDb.findDepartmentCertificateSettings(departmentId),
      organizationsDb.findOrganizationName(orgId),
    ])

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin

    const pdfBuffer = await generateCertificatePDF({
      orgName: orgName || 'Organization',
      departmentName: dept?.name || 'Department',
      sessionTitle: 'Sample Session',
      sessionDate: new Date().toLocaleDateString(),
      recipientName: 'Jane Doe',
      role: 'Attendee',
      certificateCode: 'PREVIEW',
      issuedDate: new Date().toLocaleDateString(),
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
