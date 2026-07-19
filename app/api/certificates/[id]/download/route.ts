import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireOrg, getCurrentUser } from '@/lib/auth'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import * as certificatesDb from '@/lib/db/certificates'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireAuth()
    const orgId = await requireOrg()
    const user = await getCurrentUser()

    const certificate = await certificatesDb.findCertificateForDownload(params.id, orgId)

    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    if (certificate.user_id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (certificate.status === 'REVOKED') {
      return NextResponse.json(
        { error: 'This certificate was revoked after attendance was reopened or corrected' },
        { status: 410 }
      )
    }

    const orgName = certificate.organizations?.name || 'Organization'
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin
    const verifyUrl = `${baseUrl}/verify/${certificate.certificate_code}`

    const pdfBuffer = await generateCertificatePDF({
      orgName,
      departmentName: certificate.departments?.name || 'Unknown',
      sessionTitle: certificate.sessions?.title || 'Unknown',
      sessionDate: certificate.sessions?.date_start
        ? new Date(certificate.sessions.date_start).toLocaleDateString()
        : 'Unknown',
      recipientName: certificate.recipient_name || user?.email || certificate.user_id,
      role: certificate.certificate_role === 'ATTENDEE' ? 'Attendee' : 'Teacher',
      certificateCode: certificate.certificate_code,
      issuedDate: new Date(certificate.issued_at).toLocaleDateString(),
      verifyUrl,
      coordinatorNames: resolveTeachingCoordinatorNames(
        certificate.coordinator_names,
        certificate.departments?.lead_name
      ),
      issuerName: certificate.issued_by_name || undefined,
      recognitionBasis: certificate.recognition_basis,
    })

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-${certificate.certificate_code}.pdf"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate certificate',
      },
      { status: 500 }
    )
  }
}
