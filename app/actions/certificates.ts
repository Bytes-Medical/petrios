'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import type { CertificateRole } from '@/lib/types'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { createSupabaseClient } from '@/lib/supabase/server'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'
import { DbConflictError, DbNotFoundError } from '@/lib/db'
import { requireCertificateEligibility } from '@/lib/certificates/eligibility'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import * as deliveriesDb from '@/lib/db/session-deliveries'
import type {
  ExternalTeacherCertificateCandidate,
  SessionWithCertificateContext,
} from '@/lib/db/certificates'

async function generateAndDeliverExternalTeacherCertificate(input: {
  session: SessionWithCertificateContext
  teacher: ExternalTeacherCertificateCandidate
  coordinatorNames: string[]
  issuedBy: string
  issuedByName: string | null
}) {
  const { session, teacher } = input
  const eligibility = await requireCertificateEligibility({
    sessionId: session.id,
    role: 'TEACHER',
    orgId: session.org_id,
    externalEmail: teacher.email,
    invitationId: teacher.invitationId,
  })
  const existing = await certificatesDb.findCertificateByExternalEmailAndSession(
    teacher.email,
    session.id,
    { role: 'TEACHER', includeLegacy: false }
  )

  const certificate = existing ?? await certificatesDb.insertCertificateAsSystem({
    orgId: session.org_id,
    departmentId: session.department_id,
    sessionId: session.id,
    userId: null,
    invitationId: teacher.invitationId,
    role: 'TEACHER',
    certificateCode: generateCertificateCode(),
    recipientName: teacher.recipientName,
    recipientEmail: teacher.email,
    coordinatorNames: input.coordinatorNames,
    attendanceRevision: eligibility.attendanceRevision,
    issuanceSource: 'MODERATOR_BATCH',
    issuedBy: input.issuedBy,
    issuedByName: input.issuedByName,
  })

  const delivery = await deliveriesDb.getOrCreateSessionDelivery({
    orgId: session.org_id,
    departmentId: session.department_id,
    sessionId: session.id,
    recipientEmail: teacher.email,
    deliveryType: 'TEACHING_CERTIFICATE',
    relatedId: certificate.id,
  })
  if (delivery.status === 'SENT') {
    return { certificate, pdfBuffer: null, existing: true }
  }
  if (!(await deliveriesDb.claimSessionDelivery(delivery.id))) {
    throw new Error('The external teacher certificate is already being delivered')
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || process.env.NEXT_PUBLIC_BASE_URL
      || 'http://localhost:3000'
    const pdfBuffer = await generateCertificatePDF({
      orgName: session.organizations?.name || 'Organization',
      departmentName: session.departments?.name || 'Unknown',
      sessionTitle: session.title,
      sessionDate: new Date(session.date_start).toLocaleDateString('en-GB'),
      recipientName: certificate.recipient_name || teacher.recipientName,
      role: 'Teacher',
      certificateCode: certificate.certificate_code,
      issuedDate: new Date(certificate.issued_at).toLocaleDateString('en-GB'),
      verifyUrl: `${baseUrl}/verify/${certificate.certificate_code}`,
      coordinatorNames: certificate.coordinator_names ?? input.coordinatorNames,
      issuerName: certificate.issued_by_name || input.issuedByName || undefined,
    })
    const sendResult = await getEmailClient().emails.send({
      from: getFromAddress(),
      to: teacher.email,
      subject: `Your Teaching Certificate — ${session.title}`,
      html: buildCertificateEmailHtml(session.title, teacher.recipientName, {
        role: 'TEACHER',
        attached: true,
      }),
      attachments: [{
        filename: `teaching-certificate-${certificate.certificate_code}.pdf`,
        content: pdfBuffer,
      }],
    })
    if (sendResult.error) throw new Error(sendResult.error.message)
    await deliveriesDb.recordDeliveryAttempt({
      id: delivery.id,
      success: true,
      providerMessageId: sendResult.data?.id,
    })
  } catch (error) {
    await deliveriesDb.recordDeliveryAttempt({
      id: delivery.id,
      success: false,
      error: error instanceof Error ? error.message : 'External teacher certificate delivery failed',
    }).catch(() => undefined)
    throw error
  }

  return { certificate, pdfBuffer: null, existing: Boolean(existing) }
}

export async function generateCertificate(
  sessionId: string,
  userId: string,
  role: CertificateRole
) {
  await requireAuth()
  const orgId = await requireOrg()

  const session = await certificatesDb.findSessionForCertificate(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }
  await requireDepartmentModerator(session.department_id)

  const eligibility = await requireCertificateEligibility({ sessionId, userId, role, orgId })
  const existing = await certificatesDb.findCertificateByUserAndSession(userId, sessionId, {
    role,
    includeLegacy: false,
  })
  if (existing) return { certificate: existing, pdfBuffer: null, existing: true }

  // Auth-plane: the current user is the moderator generating this certificate.
  // Stays on a direct Supabase client until the auth provider is swapped.
  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()

  // Snapshot the issuing moderator so verification can show who certified it,
  // even if their account/name changes later.
  const issuerName =
    userData?.user?.user_metadata?.full_name || userData?.user?.email || null
  const issuedBy = userData?.user?.id || null
  const targetProfile = await onboardingDb.findProfileByUserId(userId)
  const recipientName =
    targetProfile?.full_name ||
    [targetProfile?.first_name, targetProfile?.last_name].filter(Boolean).join(' ') ||
    targetProfile?.email ||
    userId

  const certificateCode = generateCertificateCode()
  const coordinatorNames = resolveTeachingCoordinatorNames(
    session.departments?.certificate_coordinator_names,
    session.departments?.lead_name
  )

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const verifyUrl = `${baseUrl}/verify/${certificateCode}`

  const pdfBuffer = await generateCertificatePDF({
    orgName: session.organizations?.name || 'Organization',
    departmentName: session.departments?.name || 'Unknown',
    sessionTitle: session.title,
    sessionDate: new Date(session.date_start).toLocaleDateString(),
    recipientName,
    role: role === 'ATTENDEE' ? 'Attendee' : 'Teacher',
    certificateCode,
    issuedDate: new Date().toLocaleDateString(),
    verifyUrl,
    coordinatorNames,
    issuerName: issuerName || undefined,
  })

  let certificate
  try {
    certificate = await certificatesDb.insertCertificate({
      orgId,
      departmentId: session.department_id,
      sessionId,
      userId,
      role,
      certificateCode,
      issuedBy,
      issuedByName: issuerName,
      recipientName,
      recipientEmail: targetProfile?.email ?? null,
      coordinatorNames,
      attendanceRevision: eligibility.attendanceRevision,
      issuanceSource: 'MODERATOR_BATCH',
    })
  } catch (error) {
    if (error instanceof DbConflictError) {
      const raced = await certificatesDb.findCertificateByUserAndSession(userId, sessionId, {
        role,
        includeLegacy: false,
      })
      if (raced) return { certificate: raced, pdfBuffer: null, existing: true }
    }
    throw error
  }

  revalidatePath('/certificates')
  return { certificate, pdfBuffer, existing: false }
}

export async function generateCertificatesForSession(sessionId: string) {
  await requireAuth()
  const orgId = await requireOrg()

  const session = await certificatesDb.findSessionForCertificate(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }
  await requireDepartmentModerator(session.department_id)

  const sessionEnd = new Date(session.date_end)
  const now = new Date()
  if (now < sessionEnd) {
    throw new Error('Cannot generate certificates before session ends')
  }

  if (session.status !== 'PUBLISHED') throw new Error('Only published sessions are eligible')
  if (session.attendance_phase !== 'FINALIZED') {
    throw new Error('Finalize attendance before generating certificates')
  }

  const [teacherIds, allAttendeeIds, externalTeachers] = await Promise.all([
    certificatesDb.listSessionTeacherIds(sessionId),
    certificatesDb.listSessionAttendeeUserIds(sessionId),
    certificatesDb.listAcceptedExternalTeachersAsSystem(sessionId),
  ])
  const teacherIdSet = new Set(teacherIds)
  const attendeeIds = allAttendeeIds.filter((attendeeId) => !teacherIdSet.has(attendeeId))

  const supabase = await createSupabaseClient()
  const { data: moderatorData } = await supabase.auth.getUser()
  const issuedBy = moderatorData?.user?.id || await requireAuth()
  const issuedByName =
    moderatorData?.user?.user_metadata?.full_name || moderatorData?.user?.email || null
  const coordinatorNames = resolveTeachingCoordinatorNames(
    session.departments?.certificate_coordinator_names,
    session.departments?.lead_name
  )

  const results = []
  const failures: { userId: string; role: CertificateRole; message: string }[] = []

  for (const teacherId of teacherIds) {
    try {
      const result = await generateCertificate(sessionId, teacherId, 'TEACHER')
      results.push(result)
    } catch (error) {
      console.error(`Failed to generate certificate for teacher ${teacherId}:`, error)
      failures.push({
        userId: teacherId,
        role: 'TEACHER',
        message: error instanceof Error ? error.message : 'Certificate generation failed',
      })
    }
  }

  for (const externalTeacher of externalTeachers) {
    try {
      const result = await generateAndDeliverExternalTeacherCertificate({
        session,
        teacher: externalTeacher,
        coordinatorNames,
        issuedBy,
        issuedByName,
      })
      results.push(result)
    } catch (error) {
      console.error(`Failed to generate certificate for external teacher ${externalTeacher.email}:`, error)
      failures.push({
        userId: `external:${externalTeacher.email}`,
        role: 'TEACHER',
        message: error instanceof Error ? error.message : 'Certificate generation failed',
      })
    }
  }

  for (const attendeeId of attendeeIds) {
    try {
      const result = await generateCertificate(sessionId, attendeeId, 'ATTENDEE')
      results.push(result)
    } catch (error) {
      console.error(`Failed to generate certificate for attendee ${attendeeId}:`, error)
      failures.push({
        userId: attendeeId,
        role: 'ATTENDEE',
        message: error instanceof Error ? error.message : 'Certificate generation failed',
      })
    }
  }

  revalidatePath(`/sessions/${sessionId}`)
  return {
    certificates: results,
    issuedCount: results.filter((result) => !result.existing).length,
    existingCount: results.filter((result) => result.existing).length,
    failures,
  }
}

export async function getMyCertificates() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  return certificatesDb.listMyCertificates(orgId, userId)
}

export async function getCertificateByCode(code: string) {
  return certificatesDb.findCertificateByCode(code)
}

export async function downloadMyCertificateForSession(sessionId: string) {
  const userId = await requireAuth()

  // Look up certificate record for this user + session (across all orgs)
  const certificate = await certificatesDb.findCertificateByUserAndSession(userId, sessionId)
  if (!certificate) {
    throw new DbNotFoundError('No certificate found for this session')
  }

  // Fetch session details for the PDF
  const session = await certificatesDb.findSessionForCertificateById(sessionId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()

  const recipientName =
    certificate.recipient_name ||
    userData?.user?.user_metadata?.full_name ||
    userData?.user?.email ||
    userId

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const verifyUrl = `${baseUrl}/verify/${certificate.certificate_code}`
  const coordinatorNames = resolveTeachingCoordinatorNames(
    certificate.coordinator_names,
    session.lead_name
  )

  const pdfBuffer = await generateCertificatePDF({
    orgName: session.org_name || 'Organization',
    departmentName: session.department_name || 'Department',
    sessionTitle: session.title,
    sessionDate: new Date(session.date_start).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    recipientName,
    role: certificate.certificate_role === 'TEACHER' ? 'Teacher' : 'Attendee',
    certificateCode: certificate.certificate_code,
    issuedDate: new Date(certificate.issued_at).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    verifyUrl,
    coordinatorNames,
    issuerName: certificate.issued_by_name || undefined,
  })

  // Return base64 for client-side download
  const base64 = Buffer.from(pdfBuffer).toString('base64')
  return { base64, filename: `certificate-${session.title.replace(/\s+/g, '-').toLowerCase()}.pdf` }
}
