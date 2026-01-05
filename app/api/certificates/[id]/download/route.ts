import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, requireOrg, getCurrentUser } from '@/lib/auth'
import { generateCertificatePDF } from '@/lib/certificates/pdf'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await requireAuth()
    const orgId = await requireOrg()
    const supabase = await createSupabaseClient()
    const user = await getCurrentUser()

    // Get certificate
    const { data: certificate, error: certError } = await supabase
      .from('certificates')
      .select(`
        *,
        sessions:session_id (id, title, date_start),
        departments:department_id (id, name),
        organizations:org_id (id, name)
      `)
      .eq('id', params.id)
      .eq('org_id', orgId)
      .single()

    if (certError || !certificate) {
      return NextResponse.json(
        { error: 'Certificate not found' },
        { status: 404 }
      )
    }

    // Verify user owns this certificate
    if (certificate.user_id !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Get org name
    const orgName = (certificate.organizations as any)?.name || 'Organization'
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin
    const verifyUrl = `${baseUrl}/verify/${certificate.certificate_code}`

    // Generate PDF
    const pdfBuffer = await generateCertificatePDF({
      orgName,
      departmentName: (certificate.departments as any)?.name || 'Unknown',
      sessionTitle: (certificate.sessions as any)?.title || 'Unknown',
      sessionDate: (certificate.sessions as any)?.date_start
        ? new Date((certificate.sessions as any).date_start).toLocaleDateString()
        : 'Unknown',
      recipientName: user?.email || certificate.user_id,
      role: certificate.certificate_role === 'ATTENDEE' ? 'Attendee' : 'Teacher',
      certificateCode: certificate.certificate_code,
      issuedDate: new Date(certificate.issued_at).toLocaleDateString(),
      verifyUrl,
    })

    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-${certificate.certificate_code}.pdf"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate certificate' },
      { status: 500 }
    )
  }
}
