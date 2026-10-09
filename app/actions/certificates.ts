'use server'

import { getAppUrl } from '@/lib/app-url'
import { revalidatePath } from 'next/cache'
import { getCurrentUser, requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import type { CertificateRole } from '@/lib/types'
import type { CertificateData } from '@/lib/certificates/pdf'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { createSupabaseClient } from '@/lib/supabase/server'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'
import { DbConflictError, DbNotFoundError } from '@/lib/db'
import { requireCertificateEligibility } from '@/lib/certificates/eligibility'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'
import {
  certificateBatchFailure,
  describeCertificateBatchRecipient,
  planCertificateBatch,
  type CertificateBatchFailure,
} from '@/lib/certificates/batch'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import * as deliveriesDb from '@/lib/db/session-deliveries'
import type {
  ExternalTeacherCertificateCandidate,
  SessionWithCertificateContext,
} from '@/lib/db/certificates'

interface CertificateIssuer {
  issuedBy: string | null
  issuedByName: string | null
}

// Loaded lazily so row-only batch issuance never pulls in the PDF renderer.
async function renderCertificatePdf(data: CertificateData): Promise<Buffer> {
  const { generateCertificatePDF } = await import('@/lib/certificates/pdf')
  return generateCertificatePDF(data)
}

/**
 * Snapshot the issuing moderator so verification can show who certified it,
 * even if their account/name changes later. Request-cached auth lookup.
 */
async function currentIssuer(): Promise<CertificateIssuer> {
  const user = await getCurrentUser()
  return {
    issuedBy: user?.id || null,
    issuedByName: user?.user_metadata?.full_name || user?.email || null,
  }
}

async function generateAndDeliverExternalTeacherCertificate(input: {
  session: SessionWithCertificateContext
  teacher: ExternalTeacherCertificateCandidate
  coordinatorNames: string[]
  issuer: CertificateIssuer
}) {
  const { session, teacher, issuer } = input
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
    recognitionBasis: eligibility.recognitionBasis,
    issuedBy: issuer.issuedBy,
    issuedByName: issuer.issuedByName,
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
    return { certificate, existing: true }
  }
  if (!(await deliveriesDb.claimSessionDelivery(delivery.id))) {
    throw new Error('The external teacher certificate is already being delivered')
  }

  try {
    // getAppUrl throws in production when unset — a certificate PDF with a
    // localhost verify link is unrecoverable once emailed.
    const baseUrl = getAppUrl()
    const pdfBuffer = await renderCertificatePdf({
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
      issuerName: certificate.issued_by_name || issuer.issuedByName || undefined,
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

  return { certificate, existing: Boolean(existing) }
}

/**
 * Issue (or reuse) one registered recipient's certificate. The moderator
 * batch passes renderPdf=false: registered recipients render their PDF on
 * authenticated download, so the batch only inserts rows.
 */
async function issueRegisteredCertificate(input: {
  session: SessionWithCertificateContext
  userId: string
  role: CertificateRole
  issuer: CertificateIssuer
  coordinatorNames: string[]
  renderPdf: boolean
}) {
  const { session, userId, role, issuer, coordinatorNames } = input
  const eligibility = await requireCertificateEligibility({
    sessionId: session.id,
    userId,
    role,
    orgId: session.org_id,
  })
  const existing = await certificatesDb.findCertificateByUserAndSession(userId, session.id, {
    role,
    includeLegacy: false,
  })
  if (existing) return { certificate: existing, pdfBuffer: null, existing: true }

  const targetProfile = await onboardingDb.findProfileByUserId(userId)
  const recipientName =
    targetProfile?.full_name ||
    [targetProfile?.first_name, targetProfile?.last_name].filter(Boolean).join(' ') ||
    targetProfile?.email ||
    userId

  const certificateCode = generateCertificateCode()

  const pdfBuffer = input.renderPdf
    ? await renderCertificatePdf({
        orgName: session.organizations?.name || 'Organization',
        departmentName: session.departments?.name || 'Unknown',
        sessionTitle: session.title,
        sessionDate: new Date(session.date_start).toLocaleDateString(),
        recipientName,
        role: role === 'ATTENDEE' ? 'Attendee' : 'Teacher',
        certificateCode,
        issuedDate: new Date().toLocaleDateString(),
        verifyUrl: `${getAppUrl()}/verify/${certificateCode}`,
        coordinatorNames,
        issuerName: issuer.issuedByName || undefined,
        recognitionBasis: eligibility.recognitionBasis,
      })
    : null

  let certificate
  try {
    certificate = await certificatesDb.insertCertificate({
      orgId: session.org_id,
      departmentId: session.department_id,
      sessionId: session.id,
      userId,
      role,
      certificateCode,
      issuedBy: issuer.issuedBy,
      issuedByName: issuer.issuedByName,
      recipientName,
      recipientEmail: targetProfile?.email ?? null,
      coordinatorNames,
      attendanceRevision: eligibility.attendanceRevision,
      issuanceSource: 'MODERATOR_BATCH',
      recognitionBasis: eligibility.recognitionBasis,
    })
  } catch (error) {
    if (error instanceof DbConflictError) {
      const raced = await certificatesDb.findCertificateByUserAndSession(userId, session.id, {
        role,
        includeLegacy: false,
      })
      if (raced) return { certificate: raced, pdfBuffer: null, existing: true }
    }
    throw error
  }

  return { certificate, pdfBuffer, existing: false }
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

  const result = await issueRegisteredCertificate({
    session,
    userId,
    role,
    issuer: await currentIssuer(),
    coordinatorNames: resolveTeachingCoordinatorNames(
      session.departments?.certificate_coordinator_names,
      session.departments?.lead_name
    ),
    renderPdf: true,
  })
  if (!result.existing) revalidatePath('/certificates')
  return result
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

  const [teacherIds, attendeeIds, externalTeachers, issuer] = await Promise.all([
    certificatesDb.listSessionTeacherIds(sessionId),
    certificatesDb.listSessionAttendeeUserIds(sessionId),
    certificatesDb.listAcceptedExternalTeachersAsSystem(sessionId),
    currentIssuer(),
  ])
  const coordinatorNames = resolveTeachingCoordinatorNames(
    session.departments?.certificate_coordinator_names,
    session.departments?.lead_name
  )

  let issuedCount = 0
  let existingCount = 0
  const failures: CertificateBatchFailure[] = []

  for (const recipient of planCertificateBatch({ teacherIds, attendeeIds, externalTeachers })) {
    try {
      const result = recipient.kind === 'external'
        ? await generateAndDeliverExternalTeacherCertificate({
            session,
            teacher: recipient.teacher,
            coordinatorNames,
            issuer,
          })
        : await issueRegisteredCertificate({
            session,
            userId: recipient.userId,
            role: recipient.role,
            issuer,
            coordinatorNames,
            renderPdf: false,
          })
      if (result.existing) existingCount += 1
      else issuedCount += 1
    } catch (error) {
      console.error(
        `Failed to generate certificate for ${describeCertificateBatchRecipient(recipient)}:`,
        error
      )
      failures.push(certificateBatchFailure(recipient, error))
    }
  }

  if (issuedCount > 0) revalidatePath('/certificates')
  revalidatePath(`/sessions/${sessionId}`)
  return { issuedCount, existingCount, failures }
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

  const baseUrl = getAppUrl()
  const verifyUrl = `${baseUrl}/verify/${certificate.certificate_code}`
  const coordinatorNames = resolveTeachingCoordinatorNames(
    certificate.coordinator_names,
    session.lead_name
  )

  const pdfBuffer = await renderCertificatePdf({
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
    recognitionBasis: certificate.recognition_basis,
  })

  // Return base64 for client-side download
  const base64 = Buffer.from(pdfBuffer).toString('base64')
  return { base64, filename: `certificate-${session.title.replace(/\s+/g, '-').toLowerCase()}.pdf` }
}
